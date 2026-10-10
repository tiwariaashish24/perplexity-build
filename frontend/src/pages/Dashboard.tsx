import axios from "axios";
import {
  ArrowUp,
  Check,
  Compass,
  Copy,
  ExternalLink,
  Globe2,
  Home,
  LogOut,
  Menu,
  MessageSquarePlus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useNavigate, useParams } from "react-router";
import { BACKEND_URL } from "@/lib/config";
import { supabase } from "@/lib/superbase/client";

type Source = { title: string; url: string };
type Message = {
  id: string;
  role: "User" | "Assistant";
  content: string;
  sources?: Source[];
};
type Conversation = { id: string; title: string | null; slug: string };
type ConversationResponse = {
  conversation: {
    messages: { id: number; content: string; role: "User" | "Assistant" }[];
  };
};
type SearchResponse = {
  conversationId: string;
  answer: string;
  sources: Source[];
};
type ModelName = "gpt-4o-mini" | "gpt-4.1-mini" | "gpt-4.1";
const availableModels: { id: ModelName; label: string }[] = [
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
];

const suggestions = [
  "What are the most exciting ideas in science right now?",
  "Explain a complex topic in simple terms",
  "What should I know about today's biggest stories?",
];
const discoveryPrompts = [
  { topic: "SCIENCE", query: "What recent scientific discovery could change everyday life?" },
  { topic: "TECHNOLOGY", query: "What are the most important AI breakthroughs this year?" },
  { topic: "CULTURE", query: "What books are people talking about right now, and why?" },
  { topic: "THE WORLD", query: "Give me a clear summary of the most important world news today." },
];

function splitSources(content: string): { answer: string; sources: Source[] } {
  const match = content.match(/<SOURCES>\s*([\s\S]*?)\s*<\/SOURCES>/);
  if (!match?.[1]) return { answer: content.trim(), sources: [] };

  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) throw new Error("Sources response was not an array");
    const sources = parsed.filter(
      (source): source is Source =>
        typeof source === "object" &&
        source !== null &&
        "title" in source &&
        typeof source.title === "string" &&
        "url" in source &&
        typeof source.url === "string",
    );
    return {
      answer: content.slice(0, match.index).trim(),
      sources,
    };
  } catch (error) {
    console.error("Unable to parse response sources:", error);
    return { answer: content.slice(0, match.index).trim(), sources: [] };
  }
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function inlineContent(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    const url = link ? safeExternalUrl(link[2] ?? "") : null;
    if (link && url) {
      return (
        <a href={url} key={index} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function AnswerText({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="answer-copy">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const heading = lines.length === 1 ? lines[0]?.match(/^(#{1,3})\s+(.+)$/) : null;
        if (heading) {
          return <h3 key={index}>{inlineContent(heading[2] ?? "")}</h3>;
        }
        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            <ul key={index}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{inlineContent(line.replace(/^\s*[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
          return (
            <ol key={index}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{inlineContent(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 && <br />}
                {inlineContent(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError<{ error?: string; message?: string }>(error)) {
    return error.response?.data?.error ?? error.response?.data?.message ?? error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId: string }>();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<ModelName>("gpt-4o-mini");
  const [webSearch, setWebSearch] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [backendStatus, setBackendStatus] = useState<
    "checking" | "connected" | "offline" | "outdated"
  >("checking");
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"history" | "discover">("history");
  const [accountOpen, setAccountOpen] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    const checkBackend = () => {
      void axios
        .get(`${BACKEND_URL}/health`, { timeout: 5000 })
        .then(() => {
          if (mounted) setBackendStatus("connected");
        })
        .catch((healthError: unknown) => {
          if (!mounted) return;
          console.error("Backend health check failed:", healthError);
          const outdated =
            axios.isAxiosError(healthError) && healthError.response?.status === 404;
          setBackendStatus(outdated ? "outdated" : "offline");
          setError(
            outdated
              ? "The backend is running an older version. Restart it from the backend folder to load the latest API."
              : `Can't connect to the backend at ${BACKEND_URL}. Start the backend server and try again.`,
          );
        });
    };
    checkBackend();
    const healthInterval = window.setInterval(checkBackend, 20_000);

    void supabase.auth
      .getSession()
      .then(({ data, error: authError }) => {
        if (!mounted) return;
        if (authError) console.error("Unable to load signed-in user:", authError.message);
        setUser(data.session?.user ?? null);
        setAuthReady(true);
      })
      .catch((authError: unknown) => {
        if (!mounted) return;
        console.error("Unable to load signed-in user:", authError);
        setAuthReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => {
      mounted = false;
      window.clearInterval(healthInterval);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady || conversationId) return;
    const pendingQuestion = sessionStorage.getItem("pending-question");
    if (pendingQuestion) {
      sessionStorage.removeItem("pending-question");
      setDraft(pendingQuestion);
      window.setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [authReady, conversationId]);

  const loadConversations = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setConversations([]);
      return;
    }
    const response = await axios.get<{ conversations: Conversation[] }>(
      `${BACKEND_URL}/conversations`,
      { headers: { Authorization: token } },
    );
    setConversations(response.data.conversations);
  }, []);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      return;
    }
    void loadConversations().catch((loadError: unknown) => {
      console.error("Unable to load conversations:", loadError);
      setError(`Couldn't load your conversation history. ${errorMessage(loadError)}`);
    });
  }, [loadConversations, user]);

  useEffect(() => {
    setError("");
    if (!conversationId || !user) {
      setMessages([]);
      setIsLoadingHistory(false);
      return;
    }

    let active = true;
    setMessages([]);
    setIsLoadingHistory(true);
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          navigate("/auth");
          return;
        }
        const response = await axios.get<ConversationResponse>(
          `${BACKEND_URL}/conversations/${encodeURIComponent(conversationId)}`,
          { headers: { Authorization: token } },
        );
        if (!active) return;
        setMessages(
          response.data.conversation.messages.map((message) => {
            const parsed = splitSources(message.content);
            return {
              id: String(message.id),
              role: message.role,
              content: parsed.answer,
              sources: parsed.sources,
            };
          }),
        );
      } catch (loadError) {
        if (!active) return;
        console.error("Unable to load conversation:", loadError);
        setError(`Couldn't open this conversation. ${errorMessage(loadError)}`);
      } finally {
        if (active) setIsLoadingHistory(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [conversationId, navigate, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  const startNewSearch = () => {
    navigate("/");
    setMessages([]);
    setDraft("");
    setError("");
    setHistoryOpen(false);
    window.setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const submitQuery = async (question = draft) => {
    const cleanQuery = question.trim();
    if (!cleanQuery || isLoading) return;
    if (!user) {
      sessionStorage.setItem("pending-question", cleanQuery);
      navigate("/auth");
      return;
    }

    setDraft("");
    setError("");
    setHistoryOpen(false);
    setIsLoading(true);
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "User",
      content: cleanQuery,
    };
    const assistantId = `assistant-${Date.now()}`;
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "Assistant", content: "" },
    ]);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        navigate("/auth");
        throw new Error("Your session has expired. Please sign in again.");
      }

      if (!conversationId) {
        const response = await axios.post<SearchResponse>(
          `${BACKEND_URL}/Perplexity_ask`,
          { query: cleanQuery, model, webSearch },
          { headers: { Authorization: token } },
        );
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: response.data.answer,
                  sources: response.data.sources,
                }
              : message,
          ),
        );
        navigate(`/c/${encodeURIComponent(response.data.conversationId)}`, { replace: true });
        void loadConversations().catch((loadError: unknown) => {
          console.error("Unable to refresh conversation history:", loadError);
        });
        return;
      }

      const response = await fetch(`${BACKEND_URL}/Perplexity_ask/follow_up`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: cleanQuery, conversationId, model, webSearch }),
      });
      if (!response.ok) {
        if (response.headers.get("content-type")?.includes("application/json")) {
          const responseBody = (await response.json()) as { error?: string; message?: string };
          throw new Error(
            responseBody.error ??
              responseBody.message ??
              `Search failed with status ${response.status}`,
          );
        }
        const responseText = await response.text();
        throw new Error(responseText || `Search failed with status ${response.status}`);
      }
      if (!response.body) throw new Error("The response stream was unavailable.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let rawAnswer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rawAnswer += decoder.decode(value, { stream: true });
        const markerIndex = rawAnswer.indexOf("<SOURCES>");
        const visibleAnswer =
          markerIndex === -1 ? rawAnswer : rawAnswer.slice(0, markerIndex).trimEnd();
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content: visibleAnswer } : message,
          ),
        );
      }
      rawAnswer += decoder.decode();
      const parsed = splitSources(rawAnswer);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: parsed.answer, sources: parsed.sources }
            : message,
        ),
      );
      void loadConversations().catch((loadError: unknown) => {
        console.error("Unable to refresh conversation history:", loadError);
      });
    } catch (requestError) {
      console.error("Search request failed:", requestError);
      setError(errorMessage(requestError));
      setMessages((current) =>
        current.filter((message) => message.id !== assistantId || message.content.length > 0),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const copyAnswer = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessage(message.id);
      window.setTimeout(() => setCopiedMessage(null), 1600);
    } catch (copyError) {
      console.error("Unable to copy answer:", copyError);
      setError("Couldn't copy the answer. Check your browser's clipboard permissions.");
    }
  };

  const logout = async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(`Couldn't sign out. ${signOutError.message}`);
      return;
    }
    setAccountOpen(false);
    setUser(null);
    startNewSearch();
  };

  const isHome = !conversationId && messages.length === 0;

  return (
    <div className="app-shell">
      <aside className="icon-rail" aria-label="Main navigation">
        <button className="brand-mark" aria-label="Perplexity home" onClick={startNewSearch}>
          <Sparkles size={22} strokeWidth={1.7} />
        </button>
        <button className="rail-new" aria-label="New thread" onClick={startNewSearch}>
          <MessageSquarePlus size={20} />
        </button>
        <nav className="rail-nav">
          <button
            className={`rail-link ${isHome ? "active" : ""}`}
            onClick={startNewSearch}
            aria-current={isHome ? "page" : undefined}
          >
            <Home size={20} />
            <span>Home</span>
          </button>
          <button
            className={`rail-link ${historyOpen && drawerMode === "history" ? "active" : ""}`}
            onClick={() => {
              setDrawerMode("history");
              setHistoryOpen((open) => (drawerMode === "history" ? !open : true));
            }}
            aria-expanded={historyOpen && drawerMode === "history"}
          >
            <Menu size={20} />
            <span>Library</span>
          </button>
          <button
            className={`rail-link ${historyOpen && drawerMode === "discover" ? "active" : ""}`}
            onClick={() => {
              setDrawerMode("discover");
              setHistoryOpen((open) => (drawerMode === "discover" ? !open : true));
            }}
            aria-expanded={historyOpen && drawerMode === "discover"}
          >
            <Compass size={20} />
            <span>Discover</span>
          </button>
        </nav>
        <div className="rail-bottom">
          {user ? (
            <div className="account-wrap">
              <button
                className="account-button"
                onClick={() => setAccountOpen((open) => !open)}
                aria-label="Account menu"
                aria-expanded={accountOpen}
              >
                <span className="avatar">{(user.email?.[0] ?? "P").toUpperCase()}</span>
              </button>
              {accountOpen && (
                <div className="account-menu">
                  <span className="account-email">{user.email}</span>
                  <button onClick={() => void logout()}>
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              className="account-button sign-in-rail"
              aria-label="Sign in"
              onClick={() => navigate("/auth")}
            >
              <span className="avatar">?</span>
            </button>
          )}
        </div>
      </aside>

      {historyOpen && (
        <>
          <button
            className="drawer-backdrop"
            onClick={() => setHistoryOpen(false)}
            aria-label="Close library"
          />
          <aside className="history-drawer" aria-label="Your library">
            <div className="drawer-heading">
              <div>
                <span className="eyebrow">
                  {drawerMode === "history" ? "YOUR LIBRARY" : "EXPLORE"}
                </span>
                <h2>{drawerMode === "history" ? "Recent threads" : "Discover something new"}</h2>
              </div>
              <button className="icon-button" onClick={() => setHistoryOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {drawerMode === "discover" ? (
              <div className="discover-list">
                <p className="discover-intro">
                  Start with a question. Follow the sources wherever they lead.
                </p>
                {discoveryPrompts.map(({ topic, query }) => (
                  <button
                    className="discover-query"
                    key={topic}
                    onClick={() => {
                      setHistoryOpen(false);
                      void submitQuery(query);
                    }}
                  >
                    <span className="eyebrow">{topic}</span>
                    <span>{query}</span>
                    <ArrowUp size={15} />
                  </button>
                ))}
              </div>
            ) : user ? (
              <>
                <button className="drawer-new" onClick={startNewSearch}>
                  <MessageSquarePlus size={17} />
                  New thread
                </button>
                <div className="thread-list">
                  {conversations.length ? (
                    conversations.map((conversation) => (
                      <button
                        className={`thread-link ${conversation.id === conversationId ? "selected" : ""}`}
                        key={conversation.id}
                        onClick={() => {
                          navigate(`/c/${encodeURIComponent(conversation.id)}`);
                          setHistoryOpen(false);
                        }}
                      >
                        <span>{conversation.title || "Untitled conversation"}</span>
                      </button>
                    ))
                  ) : (
                    <p className="drawer-empty">Your searches will show up here.</p>
                  )}
                </div>
              </>
            ) : (
              <div className="drawer-signin">
                <p>Sign in to save your searches and pick up where you left off.</p>
                <button className="primary-small" onClick={() => navigate("/auth")}>
                  Sign in
                </button>
              </div>
            )}
          </aside>
        </>
      )}

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-brand">
            <Sparkles size={18} />
            <span>perplexity</span>
            <span className="brand-pro">pro</span>
          </div>
          <div className="topbar-actions">
            <span className={`backend-status ${backendStatus}`} title="Backend connection status">
              <span />
              {backendStatus === "connected"
                ? "Backend connected"
                : backendStatus === "offline"
                  ? "Backend offline"
                  : backendStatus === "outdated"
                    ? "Restart backend"
                    : "Connecting"}
            </span>
            {!user && authReady && (
              <button className="topbar-signin" onClick={() => navigate("/auth")}>
                Sign in
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="icon-button" onClick={() => setError("")} aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        )}

        <section className={`content-area ${isHome ? "home-view" : "conversation-view"}`}>
          {isHome ? (
            <div className="home-content">
              <div className="hero-brand" aria-label="Perplexity Pro">
                <span>perplexity</span>
                <span className="hero-pro">pro</span>
              </div>
              <p className="hero-subtitle">Where knowledge begins.</p>
              <SearchComposer
                draft={draft}
                setDraft={setDraft}
                onSubmit={() => void submitQuery()}
                onSuggestion={(suggestion) => void submitQuery(suggestion)}
                textareaRef={textareaRef}
                isLoading={isLoading}
                model={model}
                setModel={setModel}
                webSearch={webSearch}
                setWebSearch={setWebSearch}
                showSuggestions
              />
              <div className="suggestion-row" aria-label="Suggested searches">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="suggestion-chip"
                    onClick={() => void submitQuery(suggestion)}
                    disabled={isLoading}
                  >
                    <Search size={14} />
                    <span>{suggestion}</span>
                  </button>
                ))}
              </div>
              {!user && authReady && (
                <p className="sign-in-note">
                  <button onClick={() => navigate("/auth")}>Sign in</button> to ask a question and save
                  your threads.
                </p>
              )}
            </div>
          ) : (
            <div className="conversation-content">
              {isLoadingHistory ? (
                <div className="conversation-loading">
                  <span className="loading-dot" />
                  Opening your thread
                </div>
              ) : (
                <>
                  <div className="message-list">
                    {messages.map((message) =>
                      message.role === "User" ? (
                        <div className="question-row" key={message.id}>
                          <div className="question-bubble">{message.content}</div>
                        </div>
                      ) : (
                        <article className="answer-message" key={message.id}>
                          <div className="answer-brand">
                            <span className="answer-mark">
                              <Sparkles size={15} />
                            </span>
                            <span>Answer</span>
                          </div>
                          {message.content ? (
                            <AnswerText content={message.content} />
                          ) : isLoading ? (
                            <div className="thinking-state">
                              <span className="loading-dot" />
                              Searching the web and putting it together…
                            </div>
                          ) : null}
                          {!!message.sources?.length && (
                            <div className="sources-section">
                              <div className="sources-title">
                                <Globe2 size={15} />
                                Sources
                              </div>
                              <div className="sources-list">
                                {message.sources.map((source, index) => {
                                  const url = safeExternalUrl(source.url);
                                  if (!url) return null;
                                  let hostname = source.url;
                                  try {
                                    hostname = new URL(url).hostname.replace(/^www\./, "");
                                  } catch {
                                    hostname = source.url;
                                  }
                                  return (
                                    <a
                                      className="source-card"
                                      href={url}
                                      key={`${url}-${index}`}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <span className="source-number">{index + 1}</span>
                                      <span className="source-details">
                                        <strong>{source.title || hostname}</strong>
                                        <small>{hostname}</small>
                                      </span>
                                      <ExternalLink size={14} />
                                    </a>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {message.content && (
                            <div className="answer-actions">
                              <button onClick={() => void copyAnswer(message)}>
                                {copiedMessage === message.id ? <Check size={15} /> : <Copy size={15} />}
                                {copiedMessage === message.id ? "Copied" : "Copy"}
                              </button>
                            </div>
                          )}
                        </article>
                      ),
                    )}
                    <div ref={bottomRef} />
                  </div>
                  <SearchComposer
                    draft={draft}
                    setDraft={setDraft}
                    onSubmit={() => void submitQuery()}
                    onSuggestion={(suggestion) => void submitQuery(suggestion)}
                    textareaRef={textareaRef}
                    isLoading={isLoading}
                    model={model}
                    setModel={setModel}
                    webSearch={webSearch}
                    setWebSearch={setWebSearch}
                    compact
                  />
                </>
              )}
            </div>
          )}
        </section>
        <footer className="privacy-note">
          Perplexity can make mistakes. Check important info.
        </footer>
      </main>
    </div>
  );
}

function SearchComposer({
  draft,
  setDraft,
  onSubmit,
  onSuggestion,
  textareaRef,
  isLoading,
  model,
  setModel,
  webSearch,
  setWebSearch,
  showSuggestions = false,
  compact = false,
}: {
  draft: string;
  setDraft: (value: string) => void;
  onSubmit: () => void;
  onSuggestion: (suggestion: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isLoading: boolean;
  model: ModelName;
  setModel: (model: ModelName) => void;
  webSearch: boolean;
  setWebSearch: (enabled: boolean) => void;
  showSuggestions?: boolean;
  compact?: boolean;
}) {
  const canSubmit = draft.trim().length > 0 && !isLoading;
  return (
    <div className={`composer-wrap ${compact ? "composer-compact" : ""}`}>
      <div className={`search-composer ${showSuggestions ? "with-suggestions" : ""}`}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Ask anything..."
          aria-label="Ask a question"
          rows={compact ? 2 : 3}
          disabled={isLoading}
        />
        <div className="composer-toolbar">
          <button
            className={`search-mode ${webSearch ? "enabled" : ""}`}
            type="button"
            onClick={() => setWebSearch(!webSearch)}
            aria-pressed={webSearch}
            title={webSearch ? "Turn web search off" : "Turn web search on"}
          >
            <span className="mode-indicator">
              <Globe2 size={15} />
            </span>
            <span>Web {webSearch ? "on" : "off"}</span>
          </button>
          <label className="model-select-wrap">
            <span className="sr-only">AI model</span>
            <select
              aria-label="AI model"
              value={model}
              onChange={(event) => setModel(event.target.value as ModelName)}
              disabled={isLoading}
            >
              {availableModels.map((availableModel) => (
                <option key={availableModel.id} value={availableModel.id}>
                  {availableModel.label}
                </option>
              ))}
            </select>
          </label>
          <span className="composer-hint">Press Enter to search</span>
          <button
            className={`submit-button ${canSubmit ? "ready" : ""}`}
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label={isLoading ? "Searching" : "Search"}
          >
            {isLoading ? <span className="button-spinner" /> : <ArrowUp size={18} />}
          </button>
        </div>
        {showSuggestions && draft.trim().length === 0 && (
          <div className="inline-suggestions">
            {["Why do we dream?", "How do solar panels work?"].map((suggestion) => (
              <button key={suggestion} onClick={() => onSuggestion(suggestion)}>
                <Search size={14} />
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
      {!compact && (
        <div className="composer-caption">
          <Sparkles size={13} />
          <span>Curious minds welcome</span>
        </div>
      )}
    </div>
  );
}
