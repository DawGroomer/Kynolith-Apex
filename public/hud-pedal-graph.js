(()=>{
  "use strict";

  const GRAPH_START_MS=-2500;
  const GRAPH_END_MS=1500;
  const GRAPH_DURATION_MS=
    GRAPH_END_MS-GRAPH_START_MS;


  function validDimension(value){
    return (
      Number.isFinite(value) &&
      value>0
    );
  }


  function validPoint(point){
    return Boolean(
      point &&
      Number.isFinite(point.offsetMs) &&
      Number.isFinite(point.brake) &&
      Number.isFinite(point.throttle) &&
      point.offsetMs>=GRAPH_START_MS &&
      point.offsetMs<=GRAPH_END_MS &&
      point.brake>=0 &&
      point.brake<=1 &&
      point.throttle>=0 &&
      point.throttle<=1
    );
  }


  function validSeries(series){
    return (
      Array.isArray(series) &&
      series.every(validPoint)
    );
  }


  function buildSeries(
    series,
    pedal,
    width,
    height
  ){
    if(
      !validSeries(series) ||
      !validDimension(width) ||
      !validDimension(height)
    ){
      return [];
    }


    return series.map(point=>({
      x:
        (
          (
            point.offsetMs-
            GRAPH_START_MS
          ) /
          GRAPH_DURATION_MS
        ) *
        width,

      y:
        height-
        point[pedal]*
        height
    }));
  }


  function buildGeometry(
    snapshot,
    pedal,
    width,
    height
  ){
    const safeWidth=
      validDimension(width)
        ?width
        :0;


    const safeHeight=
      validDimension(height)
        ?height
        :0;


    const nowX=
      safeWidth
        ?(
            (
              0-
              GRAPH_START_MS
            ) /
            GRAPH_DURATION_MS
          ) *
          safeWidth
        :0;


    const actual=
      snapshot &&
      (
        pedal==="brake" ||
        pedal==="throttle"
      )
        ?buildSeries(
            snapshot.actual,
            pedal,
            safeWidth,
            safeHeight
          )
        :[];


    const reference=
      snapshot?.state==="reference" &&
      (
        pedal==="brake" ||
        pedal==="throttle"
      )
        ?buildSeries(
            snapshot.reference,
            pedal,
            safeWidth,
            safeHeight
          )
        :[];


    return {
      actual,
      reference,
      nowX
    };
  }


  function beginTrace(
    context,
    points
  ){
    if(!points.length)return false;


    context.beginPath();


    for(
      let index=0;
      index<points.length;
      index++
    ){
      const point=
        points[index];


      if(index===0){
        context.moveTo(
          point.x,
          point.y
        );
      }
      else{
        context.lineTo(
          point.x,
          point.y
        );
      }
    }


    return true;
  }


  function readToken(
    canvas,
    name,
    fallback
  ){
    if(
      typeof getComputedStyle!=="function"
    ){
      return fallback;
    }


    const value=
      getComputedStyle(canvas)
        .getPropertyValue(name)
        .trim();


    return value||fallback;
  }


  function draw(
    canvas,
    snapshot,
    pedal
  ){
    if(
      !canvas ||
      (
        pedal!=="brake" &&
        pedal!=="throttle"
      )
    ){
      return;
    }


    const context=
      canvas.getContext?.("2d");


    if(!context)return;


    const cssWidth=
      Math.max(
        1,
        Math.round(
          canvas.clientWidth||
          canvas.width||
          480
        )
      );


    const cssHeight=
      Math.max(
        1,
        Math.round(
          canvas.clientHeight||
          canvas.height||
          128
        )
      );


    const dpr=
      Math.max(
        1,
        Number(
          window.devicePixelRatio||
          1
        )
      );


    const pixelWidth=
      Math.round(
        cssWidth*dpr
      );


    const pixelHeight=
      Math.round(
        cssHeight*dpr
      );


    if(
      canvas.width!==pixelWidth ||
      canvas.height!==pixelHeight
    ){
      canvas.width=
        pixelWidth;

      canvas.height=
        pixelHeight;
    }


    context.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );


    context.clearRect(
      0,
      0,
      cssWidth,
      cssHeight
    );


    const geometry=
      buildGeometry(
        snapshot,
        pedal,
        cssWidth,
        cssHeight
      );


    canvas.dataset.graphState=
      snapshot?.state==="reference"
        ?"reference"
        :"actual-only";


    /*
     * Lightweight guide lines only.
     * They carry no coaching authority.
     */
    context.save();

    context.strokeStyle=
      "rgba(255,255,255,.055)";

    context.lineWidth=1;


    for(
      const fraction of [
        .25,
        .5,
        .75
      ]
    ){
      const y=
        Math.round(
          cssHeight*
          fraction
        )+
        .5;


      context.beginPath();

      context.moveTo(
        0,
        y
      );

      context.lineTo(
        cssWidth,
        y
      );

      context.stroke();
    }


    context.restore();


    /*
     * Validated reference is drawn first and subdued.
     * actual-only state never reaches this branch.
     */
    if(
      geometry.reference.length
    ){
      const referenceColor=
        pedal==="brake"
          ?readToken(
              canvas,
              "--hud-brake",
              "#e0665c"
            )
          :readToken(
              canvas,
              "--hud-throttle",
              "#31cee5"
            );


      context.save();

      context.globalAlpha=.38;

      context.strokeStyle=
        referenceColor;

      context.lineWidth=2;

      context.setLineDash(
        [5,4]
      );


      if(
        beginTrace(
          context,
          geometry.reference
        )
      ){
        context.stroke();
      }


      context.restore();
    }


    /*
     * Actual driver trace is authoritative for what
     * the driver physically did.
     */
    if(
      geometry.actual.length
    ){
      const actualColor=
        pedal==="brake"
          ?readToken(
              canvas,
              "--hud-brake",
              "#e0665c"
            )
          :readToken(
              canvas,
              "--hud-throttle",
              "#31cee5"
            );


      context.save();

      context.globalAlpha=1;

      context.strokeStyle=
        actualColor;

      context.lineWidth=2.35;

      context.lineJoin=
        "round";

      context.lineCap=
        "round";


      if(
        beginTrace(
          context,
          geometry.actual
        )
      ){
        context.stroke();
      }


      context.restore();
    }


    /*
     * NOW marks offsetMs === 0.
     * Past is left, reference future is right.
     */
    context.save();

    context.strokeStyle=
      readToken(
        canvas,
        "--hud-value",
        "#f4fbfc"
      );

    context.globalAlpha=.56;

    context.lineWidth=1;

    context.setLineDash(
      [2,3]
    );

    context.beginPath();

    context.moveTo(
      geometry.nowX+.5,
      0
    );

    context.lineTo(
      geometry.nowX+.5,
      cssHeight
    );

    context.stroke();

    context.restore();
  }


  window.apexPedalGraph={
    buildGeometry,
    draw
  };
})();