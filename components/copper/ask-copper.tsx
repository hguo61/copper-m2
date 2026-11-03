"use client";

// Module 2: the Ask Copper chat panel. A floating button opens a side sheet
// where a shopper asks about prices, colours and stock. Every answer is drawn
// as a line of "stations": the tools Copper could use, what it was thinking,
// each tool it called (with what went in and what came out), and the reply.
// Tools on and tools off are two separate conversations, so the comparison
// between them is honest.
import {
  ArrowUpIcon,
  BrainIcon,
  ListIcon,
  TriangleAlertIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import Image from "next/image";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { SetupRequired } from "@/components/setup-required";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { readLive } from "@/lib/ai/live";
import { askCopper, type ChatMessage } from "@/lib/copper/assistant/ask";
import {
  type Progress,
  TOOL_LABELS,
  type ToolStep,
} from "@/lib/copper/assistant/progress";
import { cn } from "@/lib/utils";
import { ToolCallCard } from "./tool-call-card";

const STARTER_QUESTIONS = [
  "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  "Is Copper Notes in Night Sky in stock?",
  "Is Copper Plus cheaper monthly or yearly?",
];

const MASCOT = "/assets/brand/copper-mascot.png";

/** One question and the answer (as it streams in) in a conversation. */
type Turn = { question: string; answer: Progress };

/** Tools on and tools off are separate chats. */
type ChatKey = "on" | "off";

const FAILED: Progress = {
  steps: [],
  reply: "Sorry, something went wrong on our end. Please try again.",
  status: "error",
};

export function AskCopper({ aiConfigured }: { aiConfigured: boolean }) {
  const [open, setOpen] = useState(false);
  const [useTools, setUseTools] = useState(true);
  const [chats, setChats] = useState<Record<ChatKey, Turn[]>>({
    on: [],
    off: [],
  });
  const [draft, setDraft] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const key: ChatKey = useTools ? "on" : "off";
  const turns = chats[key];
  const streaming = turns.some((turn) => turn.answer.status === "working");

  // Open from the launcher, the header's "Ask Copper" link, or /#ask. The
  // link's click is watched too: once the address already ends in #ask,
  // clicking it again fires no hashchange.
  useEffect(() => {
    const openIfHash = () => {
      if (window.location.hash === "#ask") setOpen(true);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const link = target?.closest?.("a[href]");
      if (link && (link.getAttribute("href") ?? "").endsWith("#ask"))
        setOpen(true);
    };
    openIfHash();
    window.addEventListener("hashchange", openIfHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", openIfHash);
      document.removeEventListener("click", onClick);
    };
  }, []);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Drop #ask on close, so the link works again next time.
    if (!next && window.location.hash === "#ask")
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
  };

  // Keep the newest step in view as the answer streams in.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [chats, useTools]);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || streaming) return;
      const chat: ChatKey = useTools ? "on" : "off";
      const history = chats[chat];

      // Only this chat's history goes to the model: the shopper's questions
      // and Copper's finished replies, nothing about steps or tools.
      const messages: ChatMessage[] = [
        ...history
          .filter((turn) => turn.answer.reply)
          .flatMap((turn): ChatMessage[] => [
            { role: "user", content: turn.question },
            { role: "assistant", content: turn.answer.reply },
          ]),
        { role: "user", content: text },
      ];

      const index = history.length;
      setDraft("");
      setChats((prev) => ({
        ...prev,
        [chat]: [
          ...prev[chat],
          {
            question: text,
            answer: { steps: [], reply: "", status: "working" },
          },
        ],
      }));
      const put = (answer: Progress) =>
        setChats((prev) => {
          const next = [...prev[chat]];
          next[index] = { ...next[index], answer };
          return { ...prev, [chat]: next };
        });

      try {
        const { progress } = await askCopper({ messages, useTools });
        for await (const update of readLive(progress)) put(update);
      } catch (error) {
        console.error("[ask-copper]", error);
        put(FAILED);
      }
    },
    [chats, streaming, useTools],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send(draft);
  };

  return (
    <>
      <Button
        data-testid="ask-copper-launcher"
        aria-label="Ask Copper"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 h-12 gap-2 rounded-full pr-5 pl-1.5 shadow-lg"
      >
        <Image
          src={MASCOT}
          alt="Copper the robot mascot"
          width={1254}
          height={1254}
          sizes="2.25rem"
          className="bg-primary-foreground/20 size-9 rounded-full object-contain"
        />
        <span className="font-heading text-base font-bold">Ask Copper</span>
      </Button>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          data-testid="ask-copper"
          side="right"
          showCloseButton={false}
          className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        >
          <SheetHeader className="bg-primary-foreground gap-0 p-0 text-white">
            <div className="flex items-center gap-3 p-4">
              <span className="bg-primary flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full">
                <Image
                  src={MASCOT}
                  alt="Copper the robot mascot"
                  width={1254}
                  height={1254}
                  sizes="2.5rem"
                  className="size-9 object-contain"
                />
              </span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="font-heading text-lg font-bold text-white">
                  Ask Copper
                </SheetTitle>
                <SheetDescription className="text-white/70">
                  Prices, totals and stock, checked with tools.
                </SheetDescription>
              </div>
              <SheetClose asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-white hover:bg-white/10 hover:text-white"
                >
                  <XIcon />
                  <span className="sr-only">Close</span>
                </Button>
              </SheetClose>
            </div>
            {aiConfigured && (
              <div className="flex items-center justify-between gap-3 bg-white/10 px-4 py-2.5">
                <div>
                  <p className="text-sm font-semibold">Use tools</p>
                  <p className="text-xs text-white/70">
                    {useTools ? "Checks every answer" : "Model guesses alone"}
                  </p>
                </div>
                <Switch
                  aria-label="Use tools"
                  checked={useTools}
                  onCheckedChange={setUseTools}
                  className="data-unchecked:bg-white/30"
                />
              </div>
            )}
          </SheetHeader>

          <div
            ref={bodyRef}
            className="bg-secondary flex-1 overflow-y-auto px-4 py-4"
          >
            {!aiConfigured ? (
              <SetupRequired service="ai" />
            ) : (
              <div className="space-y-6">
                {turns.length === 0 && (
                  <p className="text-muted-foreground text-sm">
                    Hi, I&apos;m Copper. Ask me what our devices cost, what
                    colours they come in, or whether one is in stock today. Try
                    one of these:
                  </p>
                )}
                {turns.map((turn, i) => (
                  <TurnView key={i} turn={turn} useTools={useTools} />
                ))}
                {!streaming && (
                  <div className="space-y-2">
                    {turns.length > 0 && (
                      <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
                        Ask another
                      </p>
                    )}
                    {STARTER_QUESTIONS.map((question) => (
                      <Button
                        key={question}
                        type="button"
                        variant="outline"
                        onClick={() => void send(question)}
                        className="h-auto w-full justify-start rounded-xl px-3 py-2 text-left text-sm font-normal whitespace-normal"
                      >
                        {question}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {aiConfigured && (
            <form
              onSubmit={onSubmit}
              className="bg-background flex items-center gap-2 border-t p-3"
            >
              <Input
                aria-label="Your question"
                placeholder="Ask about prices, colours or stock…"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                autoComplete="off"
                className="h-10 rounded-full px-4"
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Send"
                disabled={streaming || !draft.trim()}
                className="size-10 shrink-0 rounded-full"
              >
                <ArrowUpIcon />
              </Button>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// One turn: the shopper's question, then Copper's answer with its stations.
// ---------------------------------------------------------------------------

function TurnView({ turn, useTools }: { turn: Turn; useTools: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm">
          {turn.question}
        </div>
      </div>
      <AnswerView progress={turn.answer} useTools={useTools} />
    </div>
  );
}

const isToolStep = (step: Progress["steps"][number]): step is ToolStep =>
  step.type === "tool";

function AnswerView({
  progress,
  useTools,
}: {
  progress: Progress;
  useTools: boolean;
}) {
  const working = progress.status === "working";
  const used = new Set(
    progress.steps.filter(isToolStep).map((step) => step.name),
  );
  const showReply = progress.reply !== "" || !working;
  let toolCount = 0;

  const nowText = !useTools
    ? progress.reply
      ? "Writing the answer…"
      : "Answering from memory…"
    : progress.reply
      ? "Writing the answer…"
      : progress.steps.length > 0
        ? "Deciding what to do next…"
        : "Reading your question…";

  return (
    <div>
      {/* The rail: a thin line the stations hang off, in order. */}
      <div className="relative pl-9">
        <div
          aria-hidden
          className={cn(
            "absolute top-3 bottom-3 left-[11px] w-0.5 rounded-full",
            useTools
              ? "bg-linear-to-b from-primary via-accent to-accent"
              : "bg-chart-3",
          )}
        />
        <div className="space-y-5">
          {/* Station 1: the menu of tools the model was handed. */}
          <Station
            node={<ListIcon className="size-3.5" />}
            nodeClass={
              useTools
                ? "bg-muted-foreground text-background"
                : "bg-chart-3 text-white"
            }
            label={
              useTools ? "Tools Copper can use" : "Tools given to Copper: none"
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(TOOL_LABELS).map((name) => (
                <span
                  key={name}
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-xs",
                    !useTools
                      ? "text-muted-foreground line-through"
                      : used.has(name)
                        ? "bg-accent text-accent-foreground font-bold"
                        : "bg-background text-muted-foreground border",
                  )}
                >
                  {name}
                </span>
              ))}
            </div>
            {!useTools && (
              <p className="text-muted-foreground mt-1.5 text-sm">
                Copper has to answer from memory alone.
              </p>
            )}
          </Station>

          {progress.steps.map((step, i) =>
            step.type === "thinking" ? (
              <Station
                key={i}
                node={<BrainIcon className="size-3.5" />}
                nodeClass={
                  useTools
                    ? "bg-primary text-primary-foreground"
                    : "bg-chart-3 text-white"
                }
                label="Copper is thinking"
              >
                <div
                  data-testid="thinking"
                  className="border-primary/40 text-muted-foreground border-l-2 pl-3 text-sm italic"
                >
                  <Markdown text={step.text} />
                </div>
              </Station>
            ) : (
              <Station
                key={step.id}
                node={<WrenchIcon className="size-3.5" />}
                nodeClass="bg-accent text-accent-foreground"
                label={
                  step.state === "calling"
                    ? "Copper is calling a tool"
                    : "Copper called a tool"
                }
              >
                <ToolCallCard step={step} index={++toolCount} />
              </Station>
            ),
          )}

          {/* Station 4: what's happening right now, only while working. */}
          {working && (
            <div className="relative">
              <span
                aria-hidden
                className="bg-primary ring-secondary absolute top-0 -left-9 flex size-6 items-center justify-center gap-0.5 rounded-full ring-4"
              >
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="bg-primary-foreground size-1 animate-bounce rounded-full"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
              <p className="text-muted-foreground pt-0.5 text-sm" role="status">
                {nowText}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* The reply: a chat bubble below the rail, tucked toward it. */}
      {showReply && (
        <div className="bg-background mt-4 ml-9 rounded-2xl rounded-tl-sm p-4 shadow-sm">
          <p className="text-primary text-xs font-bold tracking-wide">Copper</p>
          {!useTools && (
            <div className="border-chart-3 bg-chart-3/10 my-2 rounded-lg border p-3 text-sm">
              <p className="text-chart-3 flex items-center gap-1.5 font-semibold">
                <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
                <span>Answered without tools: may be made up</span>
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                With tools off, Copper can&apos;t see today&apos;s prices or
                stock. The AI only has what it learned in training, so it fills
                the gaps with guesses that sound right. That&apos;s a
                hallucination.
              </p>
            </div>
          )}
          <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
            {progress.reply}
            {working && (
              <span
                aria-hidden
                className="bg-primary ml-0.5 inline-block h-4 w-0.5 animate-pulse align-middle"
              />
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/** A station on the rail: a round node, a small uppercase label, then content. */
function Station({
  node,
  nodeClass,
  label,
  children,
}: {
  node: ReactNode;
  nodeClass: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className={cn(
          "ring-secondary absolute top-0 -left-9 flex size-6 items-center justify-center rounded-full ring-4",
          nodeClass,
        )}
      >
        {node}
      </span>
      <p className="text-muted-foreground mb-1.5 pt-0.5 text-[11px] font-semibold tracking-widest uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

/**
 * Gemini's thought summaries arrive as light markdown: **bold**, `code` and
 * the odd heading. This renders those instead of printing the marks.
 */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((block) => block.trim() !== "");
  return (
    <>
      {blocks.map((block, i) => {
        const heading = block.match(/^#{1,6}\s+(.*)$/m);
        const body = heading ? block.replace(/^#{1,6}\s+.*\n?/m, "") : block;
        return (
          <p key={i} className={cn("whitespace-pre-wrap", i > 0 && "mt-2")}>
            {heading && (
              <strong className="text-foreground block font-semibold not-italic">
                {heading[1]}
              </strong>
            )}
            {inlineMarkdown(body)}
          </p>
        );
      })}
    </>
  );
}

function inlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return (
        <strong key={i} className="text-foreground font-semibold not-italic">
          {part.slice(2, -2)}
        </strong>
      );
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={i} className="font-mono text-xs not-italic">
          {part.slice(1, -1)}
        </code>
      );
    return part;
  });
}
