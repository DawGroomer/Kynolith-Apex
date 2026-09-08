const $=id=>document.getElementById(id);let lastCue,lastState,recording,audioContext,sourceNode,processor,micStream,audioChunks=[],settings={},bindingController=false,bindingKeyboard=false,gamepadPressed=false,talkRequestId=0,voiceTurnId=0;const audioMetrics={requested:0,played:0,cancelled:0,dropped:0,failed:0,fallbacks:0,lastLatencyMs:0,maxLatencyMs:0};const audioLanes={coach:{sequence:0,abort:null,audio:null,context:null,url:null,cue:null,playing:false},spotter:{sequence:0,abort:null,audio:null,context:null,url:null,cue:null,playing:false}};window.apexAudioMetrics=audioMetrics;
const dedicatedHud=new URLSearchParams(location.search).get("hud")==="1";
let hudModeOverride=null;
if(dedicatedHud)hudModeOverride="hud";
let hudLocked=false;
let lmuLaunchPending=false;
let lmuLaunchFeedback="";


const socket=new WebSocket(`ws://${location.host}/live`);
socket.onopen=()=>{$("status").textContent="APEX ONLINE // WAITING FOR LMU"};
socket.onmessage=e=>{const m=JSON.parse(e.data);lastState=m.state;updateLmuLaunchControl(m.state);render(m.state);renderHud(m.state);queuePedalGraphRender(m.pedalGraph);applyPresentationMode(m.state);$("status").textContent=m.state.source==="lmu"&&m.state.connected?(m.state.sessionActive?"LMU TELEMETRY LIVE":"LMU CONNECTED // SESSION STOPPED"):"APEX ONLINE // SIMULATOR";$("stopSession").disabled=!m.state.sessionActive;if(m.cue&&!dedicatedHud)speakCue(m.cue)};
socket.onclose=()=>{$("status").textContent="OFFLINE"};

function shouldUseHud(s){
  if(hudModeOverride==="hud")return true;
  if(hudModeOverride==="desktop")return false;

  return Boolean(
    settings.autoHudMode!==false &&
    s?.source==="lmu" &&
    s?.connected===true &&
    s?.sessionActive===true
  );
}

function applyHudFieldVisibility(){
  const visible=new Set(
    Array.isArray(settings.hudVisibleFields)
      ? settings.hudVisibleFields
      : []
  );
  const dedicatedRequired=new Set(["speed","gear","rpm","throttle","brake","fuel","cue"]);

  document.querySelectorAll("[data-hud-field]").forEach(element=>{
    element.hidden=!visible.has(element.dataset.hudField)&&!(dedicatedHud&&dedicatedRequired.has(element.dataset.hudField));
  });
}

const HUD_LAYOUT_KEY="apex-hud-layout-v1";
const hudLayoutDefaults={
  telemetry:{x:0,y:0,scale:1,visible:true},
  "track-map":{x:0,y:0,scale:1,visible:true},
  "lap-trace":{x:0,y:0,scale:1,visible:true},
  coaching:{x:0,y:0,scale:1,visible:true}
};
let hudLayout={...hudLayoutDefaults};
try{
  const stored=JSON.parse(localStorage.getItem(HUD_LAYOUT_KEY)||"null");
  for(const [key,defaults] of Object.entries(hudLayoutDefaults)){
    const item=stored?.[key];
    if(!item||!Number.isFinite(item.x)||!Number.isFinite(item.y)||!Number.isFinite(item.scale))continue;
    hudLayout[key]={
      x:item.x,
      y:item.y,
      scale:Math.min(1.5,Math.max(.65,item.scale)),
      visible:item.visible!==false
    };
  }
}catch{}

function applyHudLayout(){
  document.querySelectorAll("[data-hud-module]").forEach(module=>{
    const layout=hudLayout[module.dataset.hudModule];
    if(!layout)return;
    module.style.setProperty("--hud-x",`${layout.x}px`);
    module.style.setProperty("--hud-y",`${layout.y}px`);
    module.style.setProperty("--hud-scale",String(layout.scale));
    module.hidden=layout.visible===false;
  });
}

function saveHudLayout(){
  try{localStorage.setItem(HUD_LAYOUT_KEY,JSON.stringify(hudLayout));}catch{}
}

function bindHudLayoutEditing(){
  document.querySelectorAll("[data-hud-module]").forEach(module=>{
    const key=module.dataset.hudModule;
    const dragHandle=module.querySelector("[data-hud-drag-handle]");
    const resizeHandle=module.querySelector(".hud-resize-handle");
    dragHandle?.addEventListener("pointerdown",event=>{
      if(hudLocked||event.target.closest(".hud-resize-handle")||event.target.closest("[data-hud-close]"))return;
      event.preventDefault();
      const startX=event.clientX,startY=event.clientY;
      const start={...hudLayout[key]};
      const move=moveEvent=>{
        hudLayout[key]={...start,x:start.x+moveEvent.clientX-startX,y:start.y+moveEvent.clientY-startY};
        applyHudLayout();
      };
      const finish=()=>{
        window.removeEventListener("pointermove",move);
        saveHudLayout();
      };
      window.addEventListener("pointermove",move);
      window.addEventListener("pointerup",finish,{once:true});
    });
    resizeHandle?.addEventListener("pointerdown",event=>{
      if(hudLocked)return;
      event.preventDefault();
      event.stopPropagation();
      const startX=event.clientX,startScale=hudLayout[key].scale;
      const move=moveEvent=>{
        hudLayout[key]={...hudLayout[key],scale:Math.min(1.5,Math.max(.65,startScale+(moveEvent.clientX-startX)/240))};
        applyHudLayout();
      };
      const finish=()=>{
        window.removeEventListener("pointermove",move);
        saveHudLayout();
      };
      window.addEventListener("pointermove",move);
      window.addEventListener("pointerup",finish,{once:true});
    });
    module.querySelector("[data-hud-close]")?.addEventListener("click",event=>{
      event.stopPropagation();
      hudLayout[key]={...hudLayout[key],visible:false};
      applyHudLayout();
      saveHudLayout();
    });
  });
  applyHudLayout();
}

bindHudLayoutEditing();

const PEDAL_GRAPH_MIN_FRAME_MS=1000/30;

let pendingPedalGraph=null;
let pedalGraphRenderPending=false;
let lastPedalGraphRenderAt=-Infinity;

function queuePedalGraphRender(snapshot){
  pendingPedalGraph=snapshot??null;

  if(pedalGraphRenderPending)return;

  pedalGraphRenderPending=true;

  requestAnimationFrame(
    flushPedalGraphRender
  );
}

function flushPedalGraphRender(now){
  if(
    now-lastPedalGraphRenderAt<
    PEDAL_GRAPH_MIN_FRAME_MS
  ){
    requestAnimationFrame(
      flushPedalGraphRender
    );

    return;
  }

  pedalGraphRenderPending=false;
  lastPedalGraphRenderAt=now;

  const latest=
    pendingPedalGraph;

  pendingPedalGraph=null;

  if(
    !window.apexPedalGraph?.draw
  ){
    return;
  }

  window.apexPedalGraph.draw(
    $("hudThrottleGraph"),
    latest,
    "throttle"
  );

  window.apexPedalGraph.draw(
    $("hudBrakeGraph"),
    latest,
    "brake"
  );
}
function applyPresentationMode(s=lastState){
  if(!s?.sessionActive && hudModeOverride==="desktop"){
    hudModeOverride=null;
  }

  const hud=shouldUseHud(s);
  const desktop=$("desktopApp");
  const hudView=$("hudView");

  if(desktop)desktop.hidden=hud;
  if(hudView)hudView.hidden=!hud;

  document.body.classList.toggle("hud-mode",hud);
}

let lastHudCueId;
function updateHudTicker(){
  const viewport=$("hudCueViewport"),message=$("hudCue");
  if(!viewport||!message)return;
  requestAnimationFrame(()=>{
    if(!viewport.isConnected||!message.isConnected)return;
    const overflowing=message.scrollWidth>viewport.clientWidth;
    if(!overflowing){
      message.classList.remove("hud-ticker-overflow");
      return;
    }
    const distance=viewport.clientWidth-message.scrollWidth;
    message.style.setProperty("--hud-ticker-distance",`${distance}px`);
    message.style.setProperty("--hud-ticker-duration",`${Math.max(8,Math.min(24,Math.abs(distance)/45))}s`);
    void message.offsetWidth;
    message.classList.add("hud-ticker-overflow");
  });
}
function setHudCueMessage(messageText,cueId){
  const message=$("hudCue");
  if(!message||cueId&&cueId===lastHudCueId)return;
  lastHudCueId=cueId;
  message.classList.remove("hud-ticker-overflow");
  message.style.removeProperty("--hud-ticker-distance");
  message.style.removeProperty("--hud-ticker-duration");
  message.textContent=messageText;
  updateHudTicker();
}

function renderHud(s){
  const f=s?.frame;
  if(!f)return;

  $("hudSpeed").textContent=Math.round(f.speedKph*.621371);
  $("hudGear").textContent=f.gear;

  $("hudThrottleValue").textContent=`${Math.round(f.throttle*100)}%`;
  $("hudBrakeValue").textContent=`${Math.round(f.brake*100)}%`;

  $("hudSession").textContent=f.session.toUpperCase();
  $("hudLap").textContent=f.lap;
  $("hudPosition").textContent=`P${f.position} / C${f.classPosition}`;

  $("hudGap").textContent=
    f.gapAheadSeconds==null
      ?"—"
      :`${f.gapAheadSeconds.toFixed(1)} s`;

  $("hudFuel").textContent=
    `${(f.fuelLiters*.264172).toFixed(1)} gal`;
  $("hudFuelMeter").style.width=`${Math.min(100,Math.max(0,f.fuelLiters/110*100))}%`;

  $("hudTire").textContent=
    `${Math.round(Math.max(...f.tireTempC)*1.8+32)} °F`;

  $("hudPressure").textContent=
    `${average(f.tirePressurePsi).toFixed(1)} PSI`;

  $("hudRpm").textContent=Math.round(f.rpm);
  $("hudSource").textContent=s.source.toUpperCase();

  $("hudConnection").textContent=
    s.source==="lmu" && s.connected
      ? s.sessionActive
        ?"LMU LIVE"
        :"LMU CONNECTED"
      : s.source==="simulator"
        ?"SIMULATOR ACTIVE"
      :"WAITING FOR LMU";
  $("hudTelemetryState").textContent=s.source==="lmu"&&s.connected?"LMU LIVE":"SIMULATOR";

  if(s.lastCue)setHudCueMessage(s.lastCue.message,s.lastCue.id);

  applyHudFieldVisibility();
}

const desktopBridge=window.apexDesktop;
function ensureLmuLaunchControl(){
  const runtime=document.querySelector(".header-runtime");
  if(!runtime||$("launchLmu"))return;
  const button=document.createElement("button");
  button.id="launchLmu";
  button.type="button";
  button.className="secondary launch-lmu";
  const message=document.createElement("span");
  message.id="launchLmuMessage";
  message.className="launch-lmu-message";
  message.setAttribute("aria-live","polite");
  runtime.insertBefore(button,$("hudEnter"));
  runtime.insertBefore(message,$("status"));
  button.addEventListener("click",launchLmu);
}
function updateLmuLaunchControl(state=lastState){
  ensureLmuLaunchControl();
  const button=$("launchLmu"),message=$("launchLmuMessage");
  if(!button)return;
  const connected=state?.source==="lmu"&&state?.connected===true;
  button.disabled=connected||lmuLaunchPending;
  button.textContent=connected
    ? state?.sessionActive ? "LMU TELEMETRY LIVE" : "LMU CONNECTED"
    : lmuLaunchPending ? "STARTING LMU..." : "LAUNCH LMU";
  if(message){
    message.textContent=connected||lmuLaunchPending
      ? connected ? "" : "Starting LMU through Steam..."
      : lmuLaunchFeedback;
  }
}
async function launchLmu(){
  const button=$("launchLmu");
  const connected=lastState?.source==="lmu"&&lastState?.connected===true;
  if(!button||lmuLaunchPending||connected)return;
  lmuLaunchFeedback="";
  lmuLaunchPending=true;
  updateLmuLaunchControl(lastState);
  try{
    if(!desktopBridge?.launchLmu)throw new Error("Desktop launcher unavailable");
    const result=await desktopBridge.launchLmu();
    lmuLaunchFeedback=result?.ok===false
      ? result.message||"Unable to launch LMU through Steam."
      : "Steam launch requested.";
  }catch{
    lmuLaunchFeedback="Unable to launch LMU through Steam.";
  }finally{
    lmuLaunchPending=false;
    updateLmuLaunchControl(lastState);
  }
}
updateLmuLaunchControl();
function enterHud(){
  if(desktopBridge?.openHud){
    void desktopBridge.openHud();
    return;
  }
  hudModeOverride="hud";
  applyPresentationMode(lastState);
}
function exitHud(){
  if(desktopBridge?.closeHud){
    void desktopBridge.closeHud();
    return;
  }
  hudModeOverride="desktop";
  applyPresentationMode(lastState);
}

$("hudEnter").onclick=enterHud;
$("hudEnterPanel").onclick=enterHud;
$("hudExit").onclick=exitHud;

const hudLock=$("hudLock");
const hudRestore=$("hudRestore");
hudRestore?.addEventListener("click",()=>{
  if(hudLocked)return;
  for(const layout of Object.values(hudLayout))layout.visible=true;
  applyHudLayout();
  saveHudLayout();
});
hudLock?.addEventListener("click",()=>{
  hudLocked=!hudLocked;
  hudLock.textContent=hudLocked?"LOCKED // RACE":"UNLOCKED // EDIT";
  document.body.classList.toggle("hud-locked",hudLocked);
  if(!hudLocked) void desktopBridge?.setHudControlsInteractive?.(false);
  void desktopBridge?.setHudLocked?.(hudLocked);
});

let hudControlsInteractive=false;
window.addEventListener("mousemove",event=>{
  if(!hudLocked)return;
  const target=document.elementFromPoint(event.clientX,event.clientY);
  const interactive=Boolean(target?.closest(".hud-actions, .hud-close"));
  if(interactive===hudControlsInteractive)return;
  hudControlsInteractive=interactive;
  void desktopBridge?.setHudControlsInteractive?.(interactive);
});

if(dedicatedHud)applyPresentationMode();

function setText(id,value){const element=$(id);if(element)element.textContent=value}
function render(s){const f=s.frame;if(!f)return;const speed=Math.round(f.speedKph*.621371),fuel=`${(f.fuelLiters*.264172).toFixed(1)} gal`,session=f.session.toUpperCase(),source=s.source.toUpperCase();setText("speed",speed);setText("gear",f.gear);setText("rpm",Math.round(f.rpm));setText("throttleValue",`${Math.round(f.throttle*100)}%`);setText("brakeValue",`${Math.round(f.brake*100)}%`);$("throttle").style.width=`${f.throttle*100}%`;$("brake").style.width=`${f.brake*100}%`;setText("fuel",fuel);$("fuelMeter").style.width=`${Math.min(100,Math.max(0,f.fuelLiters/110*100))}%`;setText("fuelHealth",fuel);setText("healthRpm",Math.round(f.rpm));setText("session",session);setText("summarySession",session);setText("barSession",session);setText("barTrack",f.track);setText("barVehicle",f.vehicle);setText("barConnection",s.source==="lmu"&&s.connected?"LMU CONNECTED":"SIMULATOR");setText("railConnection",s.source==="lmu"&&s.connected?"LMU":"SIM");setText("dashboardSource",source);setText("footerSource",source);setText("summarySource",source);setText("footerVoice",settings.voiceEngine==="system"?"WINDOWS SYSTEM":"LOCAL READY");setText("lap",f.lap);setText("position",`P${f.position} / C${f.classPosition}`);setText("gap",f.gapAheadSeconds==null?"—":`${f.gapAheadSeconds.toFixed(1)} s`);setText("tire",`${Math.round(Math.max(...f.tireTempC)*1.8+32)} °F`);setText("pressure",`${average(f.tirePressurePsi).toFixed(1)} PSI`);setText("source",source);setText("bestLap",formatTime(s.bestLapSeconds));setText("lastLap",formatTime(s.lastLapSeconds));setText("consistencyLive",s.consistencySeconds==null?"—":`±${s.consistencySeconds.toFixed(2)} s`);setText("hudPreviewSpeed",speed);setText("hudPreviewGear",f.gear);setText("hudPreviewRpm",`${Math.round(f.rpm)} RPM`);$("hudPreviewThrottle").style.width=`${f.throttle*100}%`;$("hudPreviewBrake").style.width=`${f.brake*100}%`;if(s.lastCue)setText("cue",s.lastCue.message)}

function speakCue(cue){if(cue.id===lastCue)return;lastCue=cue.id;$("cue").textContent=cue.message;setHudCueMessage(cue.message,cue.id);if(cue.speak)speak(cue.message,cue.category==="safety"||cue.category==="racecraft"?"spotter":"coach",cue.priority,cue)}
$('stopSession').onclick=async()=>{const button=$("stopSession"),status=$("sessionControlState");button.disabled=true;cancelSpeech(false);try{const result=await fetch("/api/session/stop",{method:"POST"}).then(readJson);status.textContent=result.summary?`Session saved: ${result.summary.track}. Apex will restart at the next practice, qualifying, or race.`:"Session stopped. Apex will restart at the next practice, qualifying, or race.";$("cue").textContent="Session stopped. Standing by for the next session."}catch(error){status.textContent=error.message;button.disabled=!(lastState?.sessionActive)}};
async function speak(text,role="coach",priority="info",cue=null){if(!text||recording)return;const lane=audioLanes[role],requestedAt=performance.now(),queuedAt=Date.now(),sequence=++lane.sequence;audioMetrics.requested++;if(role==="coach"&&audioLanes.spotter.playing){audioMetrics.dropped++;reportAudio(cue,{outcome:"dropped",fallbackReason:"spotter_lane_active",requestToPlaybackMs:0,telemetryToPlaybackMs:null,role});return}if(role==="spotter")cancelLane("coach","interrupted_by_spotter");cancelLane(role,"replaced_by_newer_call");lane.sequence=sequence;lane.cue=cue;const selected=role==="spotter"?(settings.spotterVoice||"am_fenrir"):(settings.neuralVoice||"af_heart");if(settings.voiceEngine==="system"){speakSystem(text,role,requestedAt,cue);return}const controller=new AbortController();lane.abort=controller;try{const emotion=priority==="critical"?"urgent":/clean|good|nailed|better/i.test(text)?"positive":priority==="technique"?"firm":"calm";const phraseKey=role==="spotter"&&cue?.id?cue.id.replace(/-\d+$/," ").trim().replace(/\s+/g,"-"):"";const response=await fetch("/api/local/speak",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,voice:selected,speed:Number(settings.voiceRate??1.05),role,emotion,phraseKey}),signal:controller.signal});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||"Neural voice unavailable")}const meta={engine:response.headers.get("X-Apex-Engine")||"kokoro-q8",voice:response.headers.get("X-Apex-Voice")||selected,cacheHit:response.headers.get("X-Apex-Cache")==="hit",synthesisMs:Number(response.headers.get("X-Apex-Synthesis-Ms")||0),queueDelayMs:Number(response.headers.get("X-Apex-Queue-Ms")||0)};const blob=await response.blob();if(sequence!==lane.sequence||recording){audioMetrics.cancelled++;reportAudio(cue,{...meta,outcome:"cancelled",fallbackReason:"obsolete_before_playback",requestToPlaybackMs:Math.round(performance.now()-requestedAt),telemetryToPlaybackMs:null,role,queuedAt});return}await playNeuralAudio(blob,role,sequence,requestedAt,queuedAt,cue,meta)}catch(err){if(err.name==="AbortError")return;audioMetrics.failed++;$("voiceState").textContent=`${role.toUpperCase()} NEURAL FAILED // ${err.message} // NO SILENT FALLBACK`;reportAudio(cue,{outcome:"failed",fallbackReason:err.message,requestToPlaybackMs:Math.round(performance.now()-requestedAt),telemetryToPlaybackMs:null,engine:"kokoro-q8",voice:selected,role,queuedAt})}finally{if(sequence===lane.sequence)lane.abort=null}}
async function playNeuralAudio(blob,role,sequence,requestedAt,queuedAt,cue,meta){const lane=audioLanes[role];if(sequence!==lane.sequence)return;lane.url=URL.createObjectURL(blob);lane.audio=new Audio(lane.url);lane.context=new AudioContext();const media=lane.context.createMediaElementSource(lane.audio),highpass=lane.context.createBiquadFilter(),presence=lane.context.createBiquadFilter(),compressor=lane.context.createDynamicsCompressor(),gain=lane.context.createGain();highpass.type="highpass";highpass.frequency.value=role==="spotter"?170:125;presence.type="peaking";presence.frequency.value=role==="spotter"?3200:2500;presence.Q.value=.9;presence.gain.value=role==="spotter"?5:3;compressor.threshold.value=-30;compressor.knee.value=18;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.15;gain.gain.value=Math.min(1.35,Math.max(0,Number(settings.voiceVolume??.9))*1.15);media.connect(highpass).connect(presence).connect(compressor).connect(gain).connect(lane.context.destination);lane.audio.onplaying=()=>{lane.playing=true;recordAudioLatency(requestedAt,queuedAt,cue,role,meta)};lane.audio.onended=()=>clearLane(role,sequence);lane.audio.onerror=()=>clearLane(role,sequence);await lane.context.resume();await lane.audio.play()}
function speakSystem(text,role,requestedAt=performance.now(),cue=null){const lane=audioLanes[role],u=new SpeechSynthesisUtterance(text);u.lang="en-US";u.volume=Number(settings.voiceVolume??.9);u.rate=Math.min(1.15,Number(settings.voiceRate??1));u.pitch=role==="spotter"?.82:Number(settings.voicePitch??1);const voices=speechSynthesis.getVoices(),coach=voices.find(v=>v.name===settings.voiceName),voice=role==="spotter"?voices.find(v=>v.lang==="en-US"&&v.name!==coach?.name&&/Guy|Ryan|Mark|David|Natural/i.test(v.name)):coach||voices.find(v=>v.lang==="en-US"&&/Natural|Aria|Jenny|Guy|Sonia|Ryan/i.test(v.name));if(voice)u.voice=voice;u.onstart=()=>{lane.playing=true;recordAudioLatency(requestedAt,Date.now(),cue,role,{engine:"system",voice:voice?.name||"Windows",cacheHit:false,synthesisMs:0,queueDelayMs:0})};u.onend=()=>{lane.playing=false};speechSynthesis.speak(u)}
function recordAudioLatency(requestedAt,queuedAt,cue,role,meta){const latency=Math.round(performance.now()-requestedAt);audioMetrics.played++;audioMetrics.lastLatencyMs=latency;audioMetrics.maxLatencyMs=Math.max(audioMetrics.maxLatencyMs,latency);reportAudio(cue,{...meta,outcome:"played",fallbackReason:null,requestToPlaybackMs:latency,telemetryToPlaybackMs:Number.isFinite(cue?.at)?Math.max(0,Date.now()-cue.at):null,playbackStartedAt:Date.now(),queuedAt,telemetryEventAt:cue?.at,role});refreshAudioStatus()}
function reportAudio(cue,metric){if(!cue?.id)return;fetch("/api/audio/delivery",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cueId:cue.id,...metric})}).catch(()=>{})}
function stopSpeaking(){cancelLane("coach","driver_interrupted");cancelLane("spotter","driver_interrupted");speechSynthesis.cancel()}
function cancelSpeech(){stopSpeaking()}
function cancelLane(role,reason){const lane=audioLanes[role];if(lane.abort){try{lane.abort.abort()}catch{}lane.abort=null;audioMetrics.cancelled++}if(lane.audio){try{lane.audio.pause()}catch{}try{if(Number.isFinite(lane.audio.duration))lane.audio.currentTime=0}catch{}}if(lane.cue&&lane.playing)reportAudio(lane.cue,{outcome:"cancelled",fallbackReason:reason,requestToPlaybackMs:0,telemetryToPlaybackMs:null,engine:"kokoro-q8",role});lane.sequence++;clearLane(role)}
function clearLane(role,sequence){const lane=audioLanes[role];if(sequence!==undefined&&sequence!==lane.sequence)return;lane.audio=null;lane.playing=false;lane.cue=null;if(lane.context){try{lane.context.close().catch(()=>{})}catch{}lane.context=null}if(lane.url){try{URL.revokeObjectURL(lane.url)}catch{}lane.url=null}}
async function refreshAudioStatus(){try{const status=await fetch("/api/audio/status").then(readJson);if($("coachEngineStatus"))$("coachEngineStatus").textContent=status.coach;if($("spotterEngineStatus"))$("spotterEngineStatus").textContent=status.spotter;if($("fallbackCount"))$("fallbackCount").textContent=String(status.fallbacksThisSession)}catch{}}

const voiceButton=$("voice");
voiceButton.addEventListener("pointerdown",stopSpeaking,true);
voiceButton.addEventListener("pointerdown",async e=>{e.preventDefault();e.stopImmediatePropagation();if(recording)return;voiceTurnId++;const requestId=++talkRequestId;try{speechSynthesis.cancel();audioChunks=[];const device=settings.microphoneDeviceId?{exact:settings.microphoneDeviceId}:undefined;const stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:device,echoCancellation:true,noiseSuppression:true,channelCount:1}});if(requestId!==talkRequestId){stream.getTracks().forEach(t=>t.stop());return}micStream=stream;audioContext=new AudioContext();sourceNode=audioContext.createMediaStreamSource(micStream);processor=audioContext.createScriptProcessor(4096,1,1);processor.onaudioprocess=event=>audioChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));sourceNode.connect(processor);processor.connect(audioContext.destination);recording=true;voiceButton.classList.add("active");voiceButton.textContent="LISTENING - RELEASE TO ASK";$("voiceState").textContent="Recording locally"}catch(err){if(requestId!==talkRequestId)return;recording=false;try{processor?.disconnect()}catch{}try{sourceNode?.disconnect()}catch{}try{micStream?.getTracks().forEach(t=>t.stop())}catch{}try{await audioContext?.close()}catch{}processor=null;sourceNode=null;micStream=null;audioContext=null;voiceButton.classList.remove("active");voiceButton.textContent="HOLD TO TALK";$("voiceState").textContent=err.message}},true);
const finishTalk=async()=>{if(!recording)return;recording=false;voiceButton.classList.remove("active");voiceButton.textContent="HOLD TO TALK";processor?.disconnect();sourceNode?.disconnect();micStream?.getTracks().forEach(t=>t.stop());const completedChunks=audioChunks;audioChunks=[];const responseId=voiceTurnId;const rate=audioContext.sampleRate;await audioContext.close();if(responseId!==voiceTurnId)return;let audio=mergeAudio(completedChunks);if(rate!==16000)audio=resample(audio,rate,16000);$("voiceState").textContent="Transcribing locally…";try{const transcription=await fetch("/api/local/transcribe",{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:audio.buffer}).then(readJson);if(responseId!==voiceTurnId)return;if(!transcription.text){$("voiceState").textContent="I didn't catch that. Hold and try again.";return}$("voiceState").textContent=`You: ${transcription.text}`;const result=await fetch("/api/local/ask",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:transcription.text})}).then(readJson);if(responseId!==voiceTurnId)return;$("cue").textContent=result.answer;$("voiceState").textContent=`Apex: ${result.answer}`;speak(result.answer)}catch(err){if(responseId!==voiceTurnId)return;$("voiceState").textContent=err.message}};
voiceButton.addEventListener("pointerup",e=>{talkRequestId++;finishTalk(e)});voiceButton.addEventListener("pointercancel",e=>{talkRequestId++;finishTalk(e)});voiceButton.addEventListener("pointerleave",e=>{if(e.buttons===0){talkRequestId++;finishTalk(e)}});

const viewNames=["live","profile","review","race","setup","settings"];
let activeView=null;
function setActiveView(view){
  if(!viewNames.includes(view)||activeView===view)return;
  activeView=view;
  document.querySelectorAll(".nav").forEach(button=>button.classList.toggle("active",button.dataset.view===view));
  for(const name of viewNames){
    const element=$(`${name}View`);
    if(!element)continue;
    const active=name===view;
    element.classList.toggle("active",active);
    element.hidden=!active;
    if(active)element.scrollTop=0;
  }
  const workspace=$("mainWorkspace");
  if(workspace)workspace.scrollTop=0;
  if(view==="profile")loadProfile();
  if(view==="review")loadSessions();
  if(view==="race")loadRaceSessions();
  if(view==="setup")loadSetupSessions();
  if(view==="settings")refreshDevices();
}
document.querySelectorAll(".nav").forEach(button=>button.onclick=()=>setActiveView(button.dataset.view));
setActiveView("live");

async function loadProfile(){const p=await fetch("/api/profile").then(readJson);$("profileName").textContent=`${p.driverName.toUpperCase()} // DRIVER PROFILE`;$("profileLevel").textContent=p.level.toUpperCase();$("profileEmpty").hidden=p.score!=null;$("profileContent").hidden=p.score==null;if(p.score==null){$("profileEmpty").textContent=`${p.currentFocus} ${p.dataQuality?.quarantinedSessions??0} session(s) are quarantined and preserved for review.`;return}$("profileScore").textContent=p.score.toFixed(1);$("profileProgress").style.width=`${p.score}%`;const previous=p.change==null?p.score:p.score-p.change;$("profileBaseline").style.left=`${Math.max(0,Math.min(100,previous))}%`;$("profileTrend").textContent=p.trend==="improved"?"You're moving forward":p.trend==="declined"?"We've lost a little ground":p.trend==="steady"?"Holding steady":"Baseline established";$("profileChange").textContent=p.change==null?"Complete another comparable trusted session to measure change.":`${p.change>=0?"+":""}${p.change.toFixed(1)} points versus your previous comparable trusted session.`;const quality=p.dataQuality??{},confidence=quality.scoreConfidence??"low";$("profileConfidence").textContent=`${confidence.toUpperCase()} CONFIDENCE`;$("profileConfidence").classList.toggle("trusted",confidence==="high");$("profileQuality").textContent=`${quality.trustedSessions??p.sessions} trusted • ${quality.limitedSessions??0} limited • ${quality.quarantinedSessions??0} quarantined • calibration ${String(quality.calibrationStatus??"uncalibrated").toUpperCase()}`;for(const key of["braking","throttle","consistency","pace"]){$(`${key}Score`).textContent=p.components[key].toFixed(1);$(`${key}Meter`).value=p.components[key]}$("profileFocus").textContent=p.currentFocus;$("profileStats").textContent=`${p.sessions} trusted sessions • ${p.completedLaps} trusted laps • ${p.personalBests} track/car baselines`;renderProgressChart(p.history);renderAcademy(p.academy)}
$("newProfile").onclick=async()=>{
  if(!confirm("Start a new profile? This will erase all recorded sessions and reset your driver progress."))return;
  const button=$("newProfile");
  button.disabled=true;
  try{
    const response=await fetch("/api/profile/reset",{method:"POST"});
    if(!response.ok)throw new Error("Unable to reset profile");
    await loadProfile();
  }catch(error){
    alert(error instanceof Error?error.message:"Unable to reset profile");
  }finally{
    button.disabled=false;
  }
};

function renderAcademy(academy){$("academyPanel")?.remove();const panel=document.createElement("section");panel.id="academyPanel";panel.className="academy-panel";const requirements=academy.requirements.length?academy.requirements.map(item=>`<div class="academy-requirement ${item.met?"met":""}"><span>${item.label}</span><b>${item.current} / ${item.target}</b></div>`).join(""):"<div class=\"academy-requirement met\"><span>Prodigy standard</span><b>MAINTAIN</b></div>";const mastery=academy.mastery.map(item=>`<div class="mastery ${item.state}"><span>${item.skill}</span><meter min="0" max="100" value="${item.score}"></meter><b>${item.state}</b></div>`).join("");panel.innerHTML=`<article class="academy-rank"><p class="eyebrow">${academy.phase}</p><div class="academy-title"><h2>${academy.rank}</h2><strong>${academy.promotionProgress}%</strong></div><p>${academy.phaseGoal}</p><p class="hint">Monitoring: ${academy.telemetryFocus.join(" • ")}</p><div class="academy-progress"><i style="width:${academy.promotionProgress}%"></i></div><h4>${academy.nextRank?`PROMOTION TO ${academy.nextRank.toUpperCase()}`:"PRODIGY STANDARD"}</h4>${requirements}</article><article class="academy-drill"><p class="eyebrow">NEXT TARGETED DRILL</p><h3>${academy.drill.name}</h3><p>${academy.drill.instructions}</p><h4>SUCCESS STANDARD</h4><p>${academy.drill.success}</p></article><article class="academy-mastery"><p class="eyebrow">SKILL MASTERY</p>${mastery}</article>`;$("profileContent").append(panel)}
function renderProgressChart(history){const svg=$("progressChart");svg.replaceChildren();if(!history.length)return;svg.append(svgEl("line",{x1:45,y1:220,x2:870,y2:220,class:"progress-axis"}));const x=i=>history.length===1?450:45+i*825/(history.length-1),y=score=>220-score*1.8;svg.append(svgEl("polyline",{points:history.map((entry,i)=>`${x(i)},${y(entry.score)}`).join(" "),class:"progress-line"}));history.forEach((entry,i)=>{const dot=svgEl("circle",{cx:x(i),cy:y(entry.score),r:6,class:"progress-dot"});dot.append(svgEl("title",{},`${entry.track}: ${entry.score.toFixed(1)}`));svg.append(dot)});svg.append(svgEl("text",{x:45,y:245,class:"progress-label"},"OLDER SESSIONS"),svgEl("text",{x:760,y:245,class:"progress-label"},"LATEST SESSION"))}

async function loadSessions(){const sessions=await fetch("/api/sessions").then(readJson);const picker=$("sessionPicker");picker.replaceChildren();if(!sessions.length){picker.add(new Option("No recorded sessions",""));$("reviewEmpty").hidden=false;$("reviewContent").hidden=true;return}for(const s of sessions){const quality=s.quality?.status??"legacy";picker.add(new Option(`${quality==="trusted"?"✓":quality==="quarantined"?"⚠":"○"} ${new Date(s.startedAt).toLocaleString()} • ${s.track} • ${quality.toUpperCase()}`,s.id))}picker.onchange=()=>loadSession(picker.value);await loadSession(picker.value)}
async function loadSession(id){if(!id)return;const data=await fetch(`/api/sessions/${encodeURIComponent(id)}`).then(readJson);$("reviewEmpty").hidden=true;$("reviewContent").hidden=false;$("primaryFocus").textContent=data.summary.primaryFocus;const quality=data.summary.quality??{status:"limited",score:0,reasons:["Legacy session has not been reclassified"]};$("sessionQuality").className=`quality-note ${quality.status}`;$("sessionQuality").textContent=`DATA ${quality.status.toUpperCase()} // ${quality.score}%${quality.reasons?.length?` // ${quality.reasons.join("; ")}`:""}`;$("fastestLap").textContent=formatTime(data.summary.fastestLapSeconds);$("consistency").textContent=data.summary.consistencySeconds==null?"—":`±${data.summary.consistencySeconds.toFixed(2)} s`;$("maxSpeed").textContent=`${data.summary.maxSpeedMph.toFixed(1)} MPH`;renderIntelligence(data);renderLapRows(data);renderTrackMap(data);const best=data.summary.laps.filter(l=>l.complete).sort((a,b)=>a.durationSeconds-b.durationSeconds)[0]||data.summary.laps[0];if(best)renderInputChart(data,best.lap);renderCueLog(data)}
function renderIntelligence(data){const intel=data.intelligence;if(!intel)return;$("sessionObjective").textContent=intel.sessionObjective;$("theoreticalBest").textContent=formatTime(intel.theoreticalBestSeconds);$("referenceLap").textContent=intel.reference?`${intel.reference.source.toUpperCase()} // ${intel.reference.label}`:"—";const skills=$("skillModel");skills.replaceChildren();for(const[key,value]of Object.entries(intel.skills)){const row=document.createElement("div");row.innerHTML=`<span>${key.replace(/([A-Z])/g," $1")}</span><meter min="0" max="100" value="${value}"></meter><b>${Math.round(value)}</b>`;skills.append(row)}const body=$("cornerRows");body.replaceChildren();for(const c of intel.corners){const row=document.createElement("tr");row.className=`corner-${c.grade}`;row.innerHTML=`<td>${c.name}</td><td>${c.lap}</td><td>${c.deltaSeconds==null?"—":`${c.deltaSeconds>=0?"+":""}${c.deltaSeconds.toFixed(3)} s`}</td><td>${c.confidence.toUpperCase()} ±${c.uncertaintySeconds.toFixed(3)} s</td><td>${c.minSpeedMph.toFixed(1)}</td><td>${c.exitSpeedMph.toFixed(1)}</td><td>${Math.round(c.peakBrake*100)}%</td><td>${c.grade.toUpperCase()}</td>`;body.append(row)}const race=$("racecraftEvidence");race.replaceChildren();race.append(evidenceItem("Multiclass encounters",String(intel.racecraft?.multiclassEncounters??0),"Different-class cars detected within the predictive range."),evidenceItem("Predictive warnings",String(intel.racecraft?.predictiveWarnings??0),"Warnings issued before physical overlap."));const setup=$("setupFindings");setup.replaceChildren();if(!intel.setupFindings?.length)setup.append(evidenceItem("No setup recommendation","DRIVE FIRST","Apex needs at least two consistent representative laps before correlating setup evidence."));else for(const finding of intel.setupFindings)setup.append(evidenceItem(finding.area,finding.confidence.toUpperCase(),`${finding.evidence} ${finding.recommendation}`));const curriculum=intel.curriculum;if(curriculum){$("curriculumPhase").textContent=curriculum.phase;$("curriculumGoal").textContent=`${curriculum.goal} Monitoring: ${curriculum.telemetryFocus.join(" • ")}.`;const technique=$("techniqueScores");technique.replaceChildren();for(const[key,value]of Object.entries(curriculum.technique))technique.append(evidenceItem(key.replace(/([A-Z])/g," $1"),String(value),"High-frequency input trace score."));const drill=curriculum.focusedDrill;$("focusedCorner").textContent=drill?`${drill.corner} // ${drill.averageLossSeconds.toFixed(3)} S LOSS // ${drill.confidence.toUpperCase()} CONFIDENCE`:"No repeatable corner loss";$("focusedCornerInstruction").textContent=drill?drill.instruction:"Keep building clean reference laps.";$("focusedCornerDiagnosis").textContent=drill?drill.diagnosis:"";const plan=$("focusedCornerPlan");plan.replaceChildren();for(const step of drill?.executionPlan??[]){const item=document.createElement("li");item.textContent=step;plan.append(item)}$("focusedCornerSuccess").textContent=drill?drill.successCriteria:""}}
function evidenceItem(title,value,detail){const item=document.createElement("div");item.className="evidence-item";const head=document.createElement("strong");head.textContent=title;const badge=document.createElement("b");badge.textContent=value;const text=document.createElement("p");text.textContent=detail;item.append(head,badge,text);return item}
function renderLapRows(data){const body=$("lapRows");body.replaceChildren();for(const lap of data.summary.laps){const row=document.createElement("tr"),quality=lap.quality??{status:lap.complete?"trusted":"limited",score:0,reasons:[]};row.title=quality.reasons?.join("; ")||"";row.innerHTML=`<td>${lap.lap}</td><td>${formatTime(lap.durationSeconds)}</td><td>${lap.averageSpeedMph.toFixed(1)}</td><td>${lap.maxSpeedMph.toFixed(1)}</td><td>${lap.brakingSmoothness}</td><td>${lap.throttleSmoothness}</td><td>${quality.status.toUpperCase()} ${quality.score}%</td>`;row.onclick=()=>{body.querySelectorAll("tr").forEach(x=>x.classList.remove("selected"));row.classList.add("selected");renderInputChart(data,lap.lap)};body.append(row)}}
function renderTrackMap(data){const svg=$("trackMap");svg.replaceChildren();const frames=data.frames.filter((f,i)=>i%3===0);if(frames.length<2)return;const xs=frames.map(f=>f.worldX),zs=frames.map(f=>f.worldZ),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),scale=Math.min(720/Math.max(1,maxX-minX),310/Math.max(1,maxZ-minZ));const point=f=>`${40+(f.worldX-minX)*scale},${350-(f.worldZ-minZ)*scale}`;svg.append(svgEl("polyline",{points:frames.map(point).join(" "),class:"track-line"}));if(data.intelligence?.model){for(const corner of data.intelligence.model.corners){const frame=frames.slice().sort((a,b)=>Math.abs(a.lapDistance-corner.apex)-Math.abs(b.lapDistance-corner.apex))[0];if(!frame)continue;const [cx,cy]=point(frame).split(","),results=data.intelligence.corners.filter(c=>c.cornerId===corner.id&&c.lap!==data.intelligence.referenceLap),worst=results.sort((a,b)=>(b.deltaSeconds??0)-(a.deltaSeconds??0))[0],grade=worst?.grade||"clean";const mark=svgEl("circle",{cx,cy,r:10,class:`corner-dot ${grade}`});mark.append(svgEl("title",{},`${corner.name}${worst?.deltaSeconds!=null?` ${worst.deltaSeconds>=0?"+":""}${worst.deltaSeconds.toFixed(3)} s`:""}`));svg.append(mark,svgEl("text",{x:Number(cx)+12,y:Number(cy)-8,class:"corner-label"},corner.name))}}for(const entry of data.cues){const frame=data.frames.filter(f=>f.lap===entry.lap).sort((a,b)=>Math.abs(a.lapDistance-entry.lapDistance)-Math.abs(b.lapDistance-entry.lapDistance))[0];if(!frame)continue;const [cx,cy]=point(frame).split(",");const dot=svgEl("circle",{cx,cy,r:5,class:`cue-dot ${entry.cue.priority}`});dot.append(svgEl("title",{},entry.cue.message));svg.append(dot)}}
function renderInputChart(data,lap){const svg=$("inputChart");svg.replaceChildren();const frames=data.frames.filter(f=>f.lap===lap);if(frames.length<2)return;const points=key=>frames.map(f=>`${30+f.lapDistance*740},${340-f[key]*290}`).join(" ");svg.append(svgEl("line",{x1:30,y1:340,x2:770,y2:340,class:"axis"}),svgEl("polyline",{points:points("throttle"),class:"throttle-line"}),svgEl("polyline",{points:points("brake"),class:"brake-line"}),svgEl("text",{x:35,y:25,class:"chart-label"},`LAP ${lap} • THROTTLE • RED BRAKE`))}
function renderCueLog(data){const root=$("cueLog");root.replaceChildren();if(!data.cues.length){root.textContent="No coaching calls recorded.";return}for(const e of data.cues){const item=document.createElement("div");item.className=`cue-item ${e.cue.priority}`;const pos=document.createElement("span"),audio=e.audioDelivery;pos.textContent=`L${e.lap} • ${(e.lapDistance*100).toFixed(0)}%${audio?` • ${(audio.role||"voice").toUpperCase()} • ${(audio.engine||"unknown").toUpperCase()} • ${audio.telemetryToPlaybackMs??"—"} MS • ${audio.outcome||"played"}${audio.cacheHit?" • CACHED":""}`:" • NOT PLAYED/MEASURED"}`;const message=document.createElement("p");message.textContent=e.cue.message;item.append(pos,message);root.append(item)}}

function svgEl(name,attrs={},text){const el=document.createElementNS("http://www.w3.org/2000/svg",name);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text)el.textContent=text;return el}
function mergeAudio(chunks){const size=chunks.reduce((n,x)=>n+x.length,0),out=new Float32Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length}return out}
function resample(input,from,to){const ratio=from/to,out=new Float32Array(Math.floor(input.length/ratio));for(let i=0;i<out.length;i++){const p=i*ratio,a=Math.floor(p),b=Math.min(input.length-1,a+1),t=p-a;out[i]=input[a]*(1-t)+input[b]*t}return out}
async function readJson(response){const body=await response.json();if(!response.ok)throw new Error(body.error||"Request failed");return body}
function formatTime(value){if(value==null||!Number.isFinite(value))return"—";const m=Math.floor(value/60),s=value-m*60;return`${m}:${s.toFixed(3).padStart(6,"0")}`}
function average(values){return values?.length?values.reduce((a,b)=>a+b,0)/values.length:0}

$("importReference").onclick=async()=>{const file=$("referenceFile").files?.[0];if(!file){$("referenceStatus").textContent="Choose an LMU, MoTeC CSV, community CSV, or Apex reference file first.";return}try{$("referenceStatus").textContent=`Converting ${file.name} locally...`;const saved=await fetch("/api/references/import-file",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-Apex-Filename":encodeURIComponent(file.name)},body:await file.arrayBuffer()}).then(readJson);const warning=saved.provenance?.warnings?.[0]?` // ${saved.provenance.warnings[0]}`:"";$("referenceStatus").textContent=`Imported ${saved.name} // ${saved.track} // ${formatTime(saved.lapTimeSeconds)}${warning}`;await loadSession($("sessionPicker").value)}catch(err){$("referenceStatus").textContent=err.message}};

const settingIds=["driverName","swearingLevel","voiceEngine","neuralVoice","spotterVoice","voiceName","voiceVolume","voiceRate","voicePitch","speechFrequency","autoSpeak","speakSafety","speakRace","speakTechnique","speakInfo","microphoneDeviceId","inputSensitivity","controllerId","controllerButton","keyboardKey","autoCheckUpdates","hudDisplayTarget"];
window.addEventListener("apex-microphone-selected",event=>{settings.microphoneDeviceId=event.detail?.deviceId||""});
async function populateHudDisplays(){const select=$("hudDisplayTarget");if(!select)return;const bridge=window.apexDesktop;if(!bridge?.getHudDisplays){$("hudDisplayState").textContent="Display selection is available in the native Apex app.";return}try{const state=await bridge.getHudDisplays();select.replaceChildren();for(const option of state.options??[])select.add(new Option(option.label,option.id));const target=state.target||"primary-display";settings.hudDisplayTarget=target;select.value=[...select.options].some(option=>option.value===target)?target:"primary-display";$("hudDisplayState").textContent=state.fellBack?"Saved display unavailable. Using the primary display.":`${state.options?.length-1||0} display surfaces detected.`}catch{$("hudDisplayState").textContent="Unable to enumerate displays. The primary display remains active."}}
async function loadSettings(){settings=await fetch("/api/settings").then(readJson);await populateHudDisplays();renderSettings();const status=await fetch("/api/local/status").then(readJson);$("sttStatus").textContent=status.speechRecognition;$("modelStatus").textContent=status.coachModel;$("ttsStatus").textContent=status.speechOutput;$("cacheStatus").textContent=status.cacheDirectory;await refreshAudioStatus()}
function renderSettings(){applyHudFieldVisibility();applyPresentationMode(lastState);applyHudFieldVisibility();applyPresentationMode(lastState);populateVoices();for(const id of settingIds){const el=$(id);if(!el)continue;if(el.type==="checkbox")el.checked=Boolean(settings[id]);else el.value=settings[id]??""}updateOutputs()}
function collectSettings(){for(const id of settingIds){const el=$(id);if(el.type==="checkbox")settings[id]=el.checked;else if(el.type==="range"||el.type==="number")settings[id]=Number(el.value);else settings[id]=el.value}return settings}
function updateOutputs(){for(const id of["voiceVolume","voiceRate","voicePitch"])$(`${id}Out`).textContent=$(id).value;$("inputSensitivityOut").textContent=`${$("inputSensitivity").value}x`;$("swearingLevelOut").textContent=["Clean","Edgy","Gruff","Full Send","Rowdy Fan"][Number($("swearingLevel").value)]}
function populateVoices(){const select=$("voiceName"),current=settings.voiceName||select.value,voices=speechSynthesis.getVoices().filter(v=>v.lang.toLowerCase().startsWith("en-us"));select.replaceChildren(new Option("Automatic American voice",""));for(const voice of voices)select.add(new Option(voice.name,voice.name));select.value=current}
speechSynthesis.onvoiceschanged=populateVoices;
async function refreshDevices(){try{const devices=await navigator.mediaDevices.enumerateDevices(),mic=$("microphoneDeviceId"),selected=settings.microphoneDeviceId||mic.value;mic.replaceChildren(new Option("System default",""));devices.filter(d=>d.kind==="audioinput").forEach((d,i)=>mic.add(new Option(d.label||`Microphone ${i+1}`,d.deviceId)));mic.value=selected}catch{}refreshControllers()}
function refreshControllers(){const pads=[...navigator.getGamepads()].filter(Boolean),select=$("controllerId"),selected=settings.controllerId||select.value;select.replaceChildren(new Option("Any connected controller",""));pads.forEach(p=>select.add(new Option(p.id,p.id)));select.value=selected;$("controllerState").textContent=pads.length?`${pads.length} controller(s) detected`:"No controller detected"}
$("saveSettings").onclick=async()=>{try{collectSettings();settings=await fetch("/api/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(settings)}).then(readJson);const displayState=await window.apexDesktop?.setHudDisplayTarget?.(settings.hudDisplayTarget);if(displayState?.target)settings.hudDisplayTarget=displayState.target;$("settingsState").textContent="Saved. Live coach behavior updated. Spotter cache is warming.";$("hudDisplayState").textContent=displayState?.fellBack?"Saved display unavailable. Using the primary display.":"HUD display surface saved.";renderSettings();await refreshAudioStatus()}catch(err){$("settingsState").textContent=err.message}};
for(const id of["voiceVolume","voiceRate","voicePitch","inputSensitivity","swearingLevel"])$(id).oninput=updateOutputs;
$("testVoice").onclick=()=>{collectSettings();const samples=["Apex voice check. Smooth inputs, clear vision, build the lap.","Come on, let's sharpen this up and build the lap.","Damn it, commit to the inputs and stop giving away the corner.","For fuck's sake, focus up, hit your marks, and drive the damn car.","Hell yeah, partner! Hit your marks, mash it clean, and let's go racing!"];speak(samples[Number(settings.swearingLevel)||0])};
$("testSpotter").onclick=()=>{collectSettings();speak("Spotter check. Car right. Hold your line. Clear right.","spotter")};
$("bindController").onclick=()=>{bindingController=true;$("bindController").classList.add("listening");$("controllerState").textContent="Press the controller button you want to use."};
$("bindKeyboard").onclick=()=>{bindingKeyboard=true;$("bindKeyboard").classList.add("listening");$("keyboardKey").value="Press a key..."};
window.addEventListener("keydown",e=>{if(bindingKeyboard){e.preventDefault();settings.keyboardKey=e.code;$("keyboardKey").value=e.code;bindingKeyboard=false;$("bindKeyboard").classList.remove("listening");return}if(e.code===(settings.keyboardKey||"Space")&&!e.repeat&&!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)){e.preventDefault();voiceButton.dispatchEvent(new PointerEvent("pointerdown"))}});
window.addEventListener("keyup",e=>{if(e.code===(settings.keyboardKey||"Space")){e.preventDefault();voiceButton.dispatchEvent(new PointerEvent("pointerup"))}});
function pollGamepads(){const pads=[...navigator.getGamepads()].filter(Boolean),pad=pads.find(p=>!settings.controllerId||p.id===settings.controllerId)||pads[0];if(bindingController&&pad){const index=pad.buttons.findIndex(b=>b.pressed);if(index>=0){settings.controllerId=pad.id;settings.controllerButton=index;$("controllerId").value=pad.id;$("controllerButton").value=index;bindingController=false;$("bindController").classList.remove("listening");$("controllerState").textContent=`Bound button ${index} on ${pad.id}`}}else if(pad){const pressed=Boolean(pad.buttons[Number(settings.controllerButton)||0]?.pressed);if(pressed&&!gamepadPressed)voiceButton.dispatchEvent(new PointerEvent("pointerdown"));if(!pressed&&gamepadPressed)voiceButton.dispatchEvent(new PointerEvent("pointerup"));gamepadPressed=pressed}requestAnimationFrame(pollGamepads)}
async function loadSetupSessions(){const all=await fetch("/api/sessions").then(readJson),sessions=all.filter(session=>session.quality?.status==="trusted"),picker=$("setupSessionPicker");picker.replaceChildren();if(!sessions.length){picker.add(new Option("No trusted sessions",""));$("setupEmpty").hidden=false;$("setupContent").hidden=true;return}for(const session of sessions)picker.add(new Option(`${new Date(session.startedAt).toLocaleString()} • ${session.track} • ${session.vehicle}`,session.id));picker.onchange=()=>loadSetupSession(picker.value);await loadSetupSession(picker.value)}
async function loadSetupSession(id){if(!id)return;const data=await fetch(`/api/sessions/${encodeURIComponent(id)}`).then(readJson),report=data.intelligence?.setupReport;if(!report)return;$("setupEmpty").hidden=true;$("setupContent").hidden=false;$("setupReadiness").textContent=`${report.readinessScore}%`;$("setupStatus").textContent=report.status.replace("-"," ").toUpperCase();const blockers=$("setupBlockers");blockers.replaceChildren();if(!report.blockers.length)blockers.append(evidenceItem("Evidence gate","PASSED","Laps are sufficiently repeatable for controlled setup experiments."));else for(const blocker of report.blockers)blockers.append(evidenceItem("Blocked","WAIT",blocker));const list=$("setupDiagnosisList");list.replaceChildren();if(!report.diagnoses.length){list.append(evidenceItem("No repeatable setup symptom","HOLD","Keep the current setup and collect more representative laps."));return}for(const diagnosis of report.diagnoses){const card=document.createElement("article");card.className=`diagnosis-card ${diagnosis.classification}`;card.innerHTML=`<div class="diagnosis-head"><div><p class="eyebrow">${diagnosis.classification.replace("-"," ")} // ${diagnosis.confidence} confidence</p><h3>${diagnosis.area}</h3></div><strong>${diagnosis.priority}</strong></div><p>${diagnosis.symptom}</p><h4>EVIDENCE</h4><ul>${diagnosis.evidence.map(item=>`<li>${item}</li>`).join("")}</ul><h4>ONE CHANGE</h4><p>${diagnosis.recommendation}</p><h4>VALIDATION</h4><p>${diagnosis.validation}</p>`;list.append(card)}}
async function loadRaceSessions(){const all=await fetch("/api/sessions").then(readJson),sessions=all.filter(session=>session.quality?.status==="trusted"),picker=$("raceSessionPicker");picker.replaceChildren();if(!sessions.length){picker.add(new Option("No trusted sessions",""));$("raceEmpty").hidden=false;$("raceContent").hidden=true;return}for(const session of sessions)picker.add(new Option(`${new Date(session.startedAt).toLocaleString()} • ${session.track} • ${session.session.toUpperCase()}`,session.id));picker.onchange=()=>loadRaceSession(picker.value);await loadRaceSession(picker.value)}
async function loadRaceSession(id){if(!id)return;const data=await fetch(`/api/sessions/${encodeURIComponent(id)}`).then(readJson),strategy=data.intelligence?.strategy,model=data.intelligence?.model;if(!strategy)return;$("raceEmpty").hidden=true;$("raceContent").hidden=false;$("strategyStatus").textContent=strategy.status.replace("-"," ").toUpperCase();$("strategyRecommendation").textContent=strategy.recommendation;$("strategyFuel").textContent=strategy.fuelPerLapGallons==null?"—":`${strategy.fuelPerLapGallons.toFixed(2)} GAL`;$("strategyRange").textContent=strategy.estimatedLapsRemaining==null?"—":strategy.estimatedLapsRemaining.toFixed(1);$("strategyWear").textContent=strategy.tireWearPerLapPercent==null?"—":`${strategy.tireWearPerLapPercent.toFixed(2)}%`;$("strategyPace").textContent=strategy.paceTrendSecondsPerLap==null?"—":`${strategy.paceTrendSecondsPerLap>=0?"+":""}${strategy.paceTrendSecondsPerLap.toFixed(2)} S/LAP`;$("strategyStint").textContent=strategy.projectedStintLaps==null?"—":`${strategy.projectedStintLaps.toFixed(0)} LAPS`;$("strategyEnergy").textContent=strategy.virtualEnergyPerLapPercent==null?"—":`${strategy.virtualEnergyPerLapPercent.toFixed(2)}%`;$("strategyEnergyRange").textContent=strategy.estimatedEnergyLapsRemaining==null?"—":strategy.estimatedEnergyLapsRemaining.toFixed(1);$("learnedTrackStatus").textContent=model?`${model.track} // ${model.source.toUpperCase()} MODEL // ${model.corners.length} CORNERS`:"Complete a valid lap to learn this circuit.";const chips=$("learnedCorners");chips.replaceChildren();for(const corner of model?.corners??[]){const chip=document.createElement("span");chip.textContent=`${corner.name} • ${(corner.apex*100).toFixed(1)}%`;chips.append(chip)}}
window.apexDesktop?.onHudDisplayFallback?.(payload=>{if(!payload?.target)return;settings.hudDisplayTarget=payload.target;const select=$("hudDisplayTarget");if(select)select.value=payload.target;const state=$("hudDisplayState");if(state)state.textContent=payload.message||"Saved display unavailable. Using the primary display."});
window.addEventListener("gamepadconnected",refreshControllers);window.addEventListener("gamepaddisconnected",refreshControllers);loadSettings().then(()=>{refreshDevices();pollGamepads()}).catch(err=>$("settingsState").textContent=err.message);
