"use server";

// Module 2: the server action the Ask Copper chat calls. It streams the
// conversation to the model through callStream (lib/ai/call.ts), with or
// without the tools, and sends back each step as it happens, so the panel can
// show Copper thinking and using its tools. The contract is in
// specs/module-2/spec.md.
import { stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type {
  Progress,
  Step,
  ToolStep,
} from "@/lib/copper/assistant/progress";
import { copperTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per question. */
const MAX_STEPS = 5;

const APOLOGY = "Sorry, I couldn't come up with an answer. Please try again.";

export async function askCopper(
  request: AskCopperRequest,
): Promise<AskCopperResult> {
  const { messages, useTools } = request;
  const live = createLive<Progress>();

  // What has happened so far. Every update sends a fresh copy of it.
  const steps: Step[] = [];
  let reply = "";
  const snapshot = (status: Progress["status"]): Progress => ({
    steps: steps.map((step) => ({ ...step })),
    reply,
    status,
  });
  const send = () => live.update(snapshot("working"));

  const toolStep = (id: string): ToolStep | undefined =>
    steps.find(
      (step): step is ToolStep => step.type === "tool" && step.id === id,
    );

  const run = async () => {
    // With tools on, Copper gets its instructions and the four tools. With
    // tools off it gets neither: just the conversation, so it answers from
    // memory alone. Thought summaries are asked for on both paths.
    const result = callStream(
      { module: 2, feature: "ask-copper" },
      useTools
        ? {
            instructions: COPPER_INSTRUCTIONS,
            messages,
            tools: copperTools,
            stopWhen: stepCountIs(MAX_STEPS),
            providerOptions: THOUGHT_SUMMARIES,
          }
        : { messages, providerOptions: THOUGHT_SUMMARIES },
    );

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta": {
          const last = steps.at(-1);
          if (last?.type === "thinking") last.text += part.text;
          else steps.push({ type: "thinking", text: part.text });
          send();
          break;
        }
        case "tool-input-start": {
          // The model has picked a tool but is still writing its input.
          steps.push({
            type: "tool",
            id: part.id,
            name: part.toolName,
            state: "calling",
          });
          send();
          break;
        }
        case "tool-call": {
          const step = toolStep(part.toolCallId);
          if (step) step.input = part.input;
          else
            steps.push({
              type: "tool",
              id: part.toolCallId,
              name: part.toolName,
              state: "calling",
              input: part.input,
            });
          send();
          break;
        }
        case "tool-result": {
          const step = toolStep(part.toolCallId);
          if (step) {
            step.output = part.output;
            step.state = "done";
            send();
          }
          break;
        }
        case "tool-error": {
          const step = toolStep(part.toolCallId);
          if (step) {
            step.output =
              part.error instanceof Error
                ? part.error.message
                : String(part.error);
            step.state = "error";
            send();
          }
          break;
        }
        case "text-delta": {
          reply += part.text;
          send();
          break;
        }
        case "error": {
          throw part.error;
        }
        default:
          break;
      }
    }

    // The stream ended normally. An empty reply still counts as done, with a
    // short apology in its place.
    if (reply.trim() === "") reply = APOLOGY;
    live.done(snapshot("done"));
  };

  // Read the stream in the background, so the panel gets the live value now
  // rather than when the answer is finished.
  run().catch((error: unknown) => {
    console.error("[ask-copper]", error);
    if (reply.trim() === "") reply = APOLOGY;
    live.done(snapshot("error"));
  });

  return { progress: live.live };
}
