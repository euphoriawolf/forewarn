# Spike: the tool loop on Muse Spark Open (27 Oct 2026)

`tool-loop.mjs` runs Muse Spark Open (`meta-models/muse-spark-open-1026` on Baseten) through the Vercel AI SDK 6 with one real tool, `read_forecast`, which reads the live 51-run ECMWF forecast and counts the runs over a flood line.

Run: `node --env-file=../.env tool-loop.mjs` (or add `stream`).

Results:
- Tool calling works through `@ai-sdk/openai-compatible`. The model called the tool with the right arguments, read the result, and answered.
- Its reasoning comes through as `reasoningText`, separate from the answer.
- `reasoningEffort: 'low'` is passed through `providerOptions.baseten`.
- Streaming: tool call at 1.4 s, first words at 3.0 s, done at 3.4 s.
- Every number in the answer matched the tool result (checked against the API directly).
- Problem: one non-streamed run called the same tool twice and took 16 s. The harness must drop repeat calls with the same arguments and cap the steps.
