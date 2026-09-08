# Third-party notices

## Crew Chief V4

Kynolith Apex is an independently developed application and is not a fork of
Crew Chief V4.

Apex's real-time coach and spotter architecture was partially informed by
concepts studied in the Crew Chief V4 project, including priority-aware audio
queuing, message expiry, playback-time validity checks, interruption of
lower-priority speech, and delaying noncritical messages during demanding
sections of a race.

These architectural concepts influenced Apex's design, but the Apex coaching,
scheduling, user interface, progression systems, local-AI integration, and
application architecture were independently implemented by Kynolith LLC.

A narrow interoperability component is directly adapted from MIT-licensed Crew
Chief V4 source code: the LMU shared-memory structure declarations originating
from:

`CrewChiefV4/LMU/LMUData.cs`

The Apex native telemetry bridge changes local namespaces and integration code
while preserving compatible field layouts required to read Le Mans Ultimate
shared-memory telemetry.

Those adapted portions remain subject to the Crew Chief V4 MIT License.

Crew Chief V4:
https://gitlab.com/mr_belowski/CrewChiefV4

Copyright (c) 2019-2024 Britton IT Ltd

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to inclusion of the copyright and permission notice.

The software is provided "as is", without warranty of any kind.

## Local AI components

The local AI runtime uses Transformers.js (Apache-2.0), Qwen3 model weights (Apache-2.0), Whisper model weights derived from OpenAI Whisper (MIT), and Kokoro plus kokoro-js (Apache-2.0) for neural speech. Development builds download model assets from Hugging Face on first use. Release builds can stage those assets into the portable package for offline first launch.
