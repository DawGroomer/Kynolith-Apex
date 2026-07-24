import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { convertReferenceFile } from "../src/reference-converter.js";

const args = process.argv.slice(2).filter(argument => argument !== "--");
const [input, output] = args;
if (!input || !output) throw new Error("Usage: pnpm reference:convert -- <input.duckdb|input.csv|input.json> <output.json>");
const converted = await convertReferenceFile(path.basename(input), await readFile(input));
await writeFile(output, JSON.stringify(converted), "utf8");
console.log(`Converted ${input} to ${output}`);
