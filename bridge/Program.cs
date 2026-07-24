using System.Diagnostics;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using rF2SharedMemory;
using rF2SharedMemory.LMUData;

namespace Kynolith.LmuBridge;

internal static class Program
{
    private const double Gravity = 9.80665;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task<int> Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) return Fail("LMU bridge requires Windows.");
        if (!ValidateLayouts()) return 2;
        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
        {
            Console.WriteLine("{\"status\":\"ok\",\"telemetrySize\":241680,\"scoringSize\":75312}");
            return 0;
        }

        Console.Error.WriteLine("Kynolith LMU bridge ready; waiting for LMU telemetry.");
        using var shutdown = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; shutdown.Cancel(); };

        while (!shutdown.IsCancellationRequested)
        {
            try { await ReadSession(shutdown.Token); }
            catch (FileNotFoundException) { await Delay(shutdown.Token); }
            catch (UnauthorizedAccessException ex) { Console.Error.WriteLine($"LMU shared memory access denied: {ex.Message}"); await Delay(shutdown.Token); }
            catch (Exception ex) { Console.Error.WriteLine($"LMU bridge reconnecting: {ex.Message}"); await Delay(shutdown.Token); }
        }
        return 0;
    }

    private static async Task ReadSession(CancellationToken cancellation)
    {
        using var telemetryMap = MemoryMappedFile.OpenExisting(LMUConstants.MM_TELEMETRY_FILE_NAME, MemoryMappedFileRights.Read);
        using var scoringMap = MemoryMappedFile.OpenExisting(LMUConstants.MM_SCORING_FILE_NAME, MemoryMappedFileRights.Read);
        using var telemetryView = telemetryMap.CreateViewAccessor(0, LMUConstants.MM_TELEMETRY_STRUCT_SIZE, MemoryMappedFileAccess.Read);
        using var scoringView = scoringMap.CreateViewAccessor(0, LMUConstants.MM_SCORING_STRUCT_SIZE, MemoryMappedFileAccess.Read);
        var telemetryBytes = new byte[LMUConstants.MM_TELEMETRY_STRUCT_SIZE];
        var scoringBytes = new byte[LMUConstants.MM_SCORING_STRUCT_SIZE];
        Console.Error.WriteLine("LMU telemetry connected.");

        while (!cancellation.IsCancellationRequested && IsLmuRunning())
        {
            if (!TryRead(telemetryView, telemetryBytes, out rF2Telemetry telemetry) ||
                !TryRead(scoringView, scoringBytes, out rF2Scoring scoring))
            {
                await Task.Delay(10, cancellation); continue;
            }
            var frame = MapFrame(telemetry, scoring);
            if (frame is not null) Console.WriteLine(JsonSerializer.Serialize(frame, JsonOptions));
            await Task.Delay(50, cancellation);
        }
        Console.Error.WriteLine("LMU telemetry disconnected.");
    }

    private static bool TryRead<T>(MemoryMappedViewAccessor view, byte[] bytes, out T value) where T : struct
    {
        view.ReadArray(0, bytes, 0, bytes.Length);
        var begin = BitConverter.ToUInt32(bytes, 0);
        var end = BitConverter.ToUInt32(bytes, 4);
        if (begin == 0 || begin != end) { value = default; return false; }
        var handle = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try { value = Marshal.PtrToStructure<T>(handle.AddrOfPinnedObject()); return true; }
        finally { handle.Free(); }
    }

    private static object? MapFrame(rF2Telemetry telemetry, rF2Scoring scoring)
    {
        var scoringVehicles = scoring.mVehicles;
        if (scoringVehicles is null) return null;
        var scoringCount = Math.Clamp(scoring.mScoringInfo.mNumVehicles, 0, scoringVehicles.Length);
        var playerScoreIndex = -1;
        for (var i = 0; i < scoringCount; i++) if (scoringVehicles[i].mIsPlayer != 0) { playerScoreIndex = i; break; }
        if (playerScoreIndex < 0) return null;
        var playerScore = scoringVehicles[playerScoreIndex];

        var telemetryVehicles = telemetry.mVehicles;
        if (telemetryVehicles is null) return null;
        var telemetryCount = Math.Clamp(telemetry.mNumVehicles, 0, telemetryVehicles.Length);
        var telemetryIndex = -1;
        for (var i = 0; i < telemetryCount; i++) if (telemetryVehicles[i].mID == playerScore.mID) { telemetryIndex = i; break; }
        if (telemetryIndex < 0) return null;
        var car = telemetryVehicles[telemetryIndex];
        var speed = Math.Sqrt(Square(car.mLocalVel.x) + Square(car.mLocalVel.y) + Square(car.mLocalVel.z)) * 3.6;
        var tires = car.mWheels ?? [];
        var tireTemps = Enumerable.Range(0, 4).Select(i => i < tires.Length ? TireTemp(tires[i]) : 0).ToArray();
        var tireWear = Enumerable.Range(0, 4).Select(i => i < tires.Length ? Clamp01(tires[i].mWear) : 0).ToArray();
        var tirePressurePsi = Enumerable.Range(0, 4).Select(i => i < tires.Length ? tires[i].mPressure * 0.1450377377 : 0).ToArray();
        var brakeTempF = Enumerable.Range(0, 4).Select(i => i < tires.Length ? tires[i].mBrakeTemp * 9 / 5 + 32 : 0).ToArray();
        var vehicleClass = Decode(playerScore.mVehicleClass);
        var classPosition = 1;
        for (var i = 0; i < scoringCount; i++)
        {
            var other = scoringVehicles[i];
            if (other.mPlace < playerScore.mPlace && string.Equals(Decode(other.mVehicleClass), vehicleClass, StringComparison.OrdinalIgnoreCase)) classPosition++;
        }
        var trackLength = scoring.mScoringInfo.mLapDist;
        var lapDistance = trackLength > 1 ? Math.Clamp(playerScore.mLapDist / trackLength, 0, 1) : 0;
        var session = scoring.mScoringInfo.mSession switch { >= 1 and <= 4 => "practice", >= 5 and <= 8 => "qualifying", >= 10 and <= 13 => "race", _ => "unknown" };
        var (carLeft, carRight) = CarsAlongside(playerScore, scoringVehicles, scoringCount);
        var offTrackWheels = tires.Count(wheel => wheel.mSurfaceType is >= 2 and <= 4);

        return new
        {
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), session,
            track = Decode(scoring.mScoringInfo.mTrackName), vehicle = Decode(car.mVehicleName),
            lap = Math.Max(1, playerScore.mTotalLaps + 1), lapDistance, worldX = car.mPos.x, worldZ = car.mPos.z, speedKph = speed,
            gear = car.mGear, rpm = car.mEngineRPM, throttle = Clamp01(car.mUnfilteredThrottle),
            brake = Clamp01(car.mUnfilteredBrake), steering = Math.Clamp(car.mUnfilteredSteering, -1, 1),
            lateralG = car.mLocalAccel.x / Gravity, longitudinalG = -car.mLocalAccel.z / Gravity,
            fuelLiters = Math.Max(0, car.mFuel), tireTempC = tireTemps, tireWear, tirePressurePsi, brakeTempF,
            position = Math.Max(1, (int)playerScore.mPlace), classPosition,
            gapAheadSeconds = ValidGap(car.mTimeGapCarAhead), gapBehindSeconds = ValidGap(car.mTimeGapCarBehind),
            // LMU's yellow-state and sector arrays can retain transitional/stale
            // values. Game phase 6 is the authoritative active FCY/safety-car state.
            inPits = playerScore.mInPits != 0, yellowFlag = scoring.mScoringInfo.mGamePhase == 6, carLeft, carRight,
            offTrackWheels, trackLimitsSteps = (int)car.mTrackLimitsSteps, lapInvalidated = car.mLapInvalidated != 0
        };
    }

    private static (bool Left, bool Right) CarsAlongside(rF2VehicleScoring player, rF2VehicleScoring[] vehicles, int count)
    {
        if (player.mOri is null || player.mOri.Length < 3) return (false, false);
        var left = false; var right = false;
        for (var i = 0; i < count; i++)
        {
            var other = vehicles[i];
            if (other.mID == player.mID || other.mInPits != 0) continue;
            var dx = other.mPos.x - player.mPos.x; var dy = other.mPos.y - player.mPos.y; var dz = other.mPos.z - player.mPos.z;
            var localX = dx * player.mOri[0].x + dy * player.mOri[1].x + dz * player.mOri[2].x;
            var localZ = dx * player.mOri[0].z + dy * player.mOri[1].z + dz * player.mOri[2].z;
            if (Math.Abs(localZ) > 7.5 || Math.Abs(localX) < 1.1 || Math.Abs(localX) > 5.5) continue;
            if (localX > 0) left = true; else right = true;
        }
        return (left, right);
    }

    private static double TireTemp(rF2Wheel wheel)
    {
        if (wheel.mTireCarcassTemperature > 200) return wheel.mTireCarcassTemperature - 273.15;
        var values = wheel.mTemperature?.Where(v => v > 200).Select(v => v - 273.15).ToArray() ?? [];
        return values.Length == 0 ? 0 : values.Average();
    }

    private static string Decode(byte[]? bytes)
    {
        if (bytes is null) return "Unknown";
        var count = Array.IndexOf(bytes, (byte)0); if (count < 0) count = bytes.Length;
        return Encoding.UTF8.GetString(bytes, 0, count).Trim();
    }

    private static double? ValidGap(float value) => float.IsFinite(value) && value >= 0 && value < 3600 ? value : null;
    private static double Clamp01(double value) => Math.Clamp(double.IsFinite(value) ? value : 0, 0, 1);
    private static double Square(double value) => value * value;
    private static bool IsLmuRunning() => Process.GetProcessesByName("Le Mans Ultimate").Length > 0 || Process.GetProcessesByName("LeMansUltimate").Length > 0;
    private static async Task Delay(CancellationToken token) { Console.Error.WriteLine("Waiting for Le Mans Ultimate..."); await Task.Delay(1500, token); }
    private static int Fail(string message) { Console.Error.WriteLine(message); return 1; }

    private static bool ValidateLayouts()
    {
        var telemetry = Marshal.SizeOf<rF2Telemetry>(); var scoring = Marshal.SizeOf<rF2Scoring>();
        if (telemetry == LMUConstants.MM_TELEMETRY_STRUCT_SIZE && scoring == LMUConstants.MM_SCORING_STRUCT_SIZE) return true;
        Console.Error.WriteLine($"LMU layout mismatch: telemetry={telemetry}/{LMUConstants.MM_TELEMETRY_STRUCT_SIZE}, scoring={scoring}/{LMUConstants.MM_SCORING_STRUCT_SIZE}");
        return false;
    }
}
