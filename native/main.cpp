#include <SharedMemoryInterface.hpp>
#include <iostream>
#include <iomanip>
#include <string>

static std::string safe(const char* s, size_t max) { size_t n=0; while(n<max && s[n]) ++n; return std::string(s,n); }
int main() {
  auto lock = SharedMemoryLock::MakeSharedMemoryLock();
  if (!lock) { std::cerr << "Unable to initialize LMU shared-memory lock\n"; return 2; }
  HANDLE event = OpenEventA(SYNCHRONIZE, FALSE, LMU_SHARED_MEMORY_EVENT);
  HANDLE map = OpenFileMappingA(FILE_MAP_READ, FALSE, LMU_SHARED_MEMORY_FILE);
  if (!event || !map) { std::cerr << "LMU shared memory is unavailable; start LMU and enter a session\n"; return 3; }
  auto* view = static_cast<SharedMemoryLayout*>(MapViewOfFile(map, FILE_MAP_READ, 0, 0, sizeof(SharedMemoryLayout)));
  if (!view) { std::cerr << "Could not map LMU_Data\n"; return 4; }
  SharedMemoryObjectOut snapshot{};
  std::cout << std::fixed << std::setprecision(4);
  while (WaitForSingleObject(event, 2000) == WAIT_OBJECT_0) {
    if (!lock->Lock(50)) continue;
    CopySharedMemoryObj(snapshot, view->data);
    lock->Unlock();
    if (!snapshot.telemetry.playerHasVehicle || snapshot.telemetry.playerVehicleIdx >= snapshot.telemetry.activeVehicles) continue;
    const auto& t = snapshot.telemetry.telemInfo[snapshot.telemetry.playerVehicleIdx];
    const double speed = std::sqrt(t.mLocalVel.x*t.mLocalVel.x+t.mLocalVel.y*t.mLocalVel.y+t.mLocalVel.z*t.mLocalVel.z)*3.6;
    std::cout << "{\"timestamp\":" << static_cast<long long>(t.mElapsedTime*1000) << ",\"track\":\"" << safe(t.mTrackName,64)
      << "\",\"vehicle\":\"" << safe(t.mVehicleName,64) << "\",\"lap\":" << t.mLapNumber << ",\"speedKph\":" << speed
      << ",\"gear\":" << t.mGear << ",\"rpm\":" << t.mEngineRPM << ",\"throttle\":" << t.mUnfilteredThrottle
      << ",\"brake\":" << t.mUnfilteredBrake << ",\"steering\":" << t.mUnfilteredSteering << "}" << std::endl;
  }
  UnmapViewOfFile(view); CloseHandle(map); CloseHandle(event); return 0;
}
