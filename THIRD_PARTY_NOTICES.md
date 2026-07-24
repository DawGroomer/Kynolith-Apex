# Third-party notices

## Crew Chief V4

This project uses architectural concepts learned from the Crew Chief V4 source code, particularly priority-aware audio queuing, message expiry, playback-time validity checks, and delaying noncritical messages during demanding track sections. The native telemetry bridge also adapts the MIT-licensed LMU shared-memory structure declarations from `CrewChiefV4/LMU/LMUData.cs`; local namespace references were changed to the LMU constants while field layouts were preserved for interoperability.

Crew Chief V4 is licensed under the MIT License.

Copyright (c) 2019-2024 Britton IT Ltd

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to inclusion of the copyright and permission notice. The software is provided "as is", without warranty of any kind.

Source reference: https://gitlab.com/mr_belowski/CrewChiefV4

## Local AI components

The local AI runtime uses Transformers.js (Apache-2.0), Qwen3 model weights (Apache-2.0), Whisper model weights derived from OpenAI Whisper (MIT), and Kokoro plus kokoro-js (Apache-2.0) for neural speech. Development builds download model assets from Hugging Face on first use. Release builds can stage those assets into the portable package for offline first launch.
