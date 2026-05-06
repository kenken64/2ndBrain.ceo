import { ArrowUp, ChevronDown, Mic, Plus } from "lucide-react";

type ChatInputProps = {
  placeholder: string;
  className?: string;
  returnTo?: string;
};

export function ChatInput({ placeholder, className, returnTo = "/dashboard" }: ChatInputProps) {
  return (
    <form action="/api/projects" className={`chat-input ${className ?? ""}`} method="post">
      <textarea
        aria-label="Project prompt"
        className="chat-input__textarea"
        name="prompt"
        placeholder={placeholder}
        rows={3}
      />
      <input name="returnTo" type="hidden" value={returnTo} />
      <div className="chat-input__bar">
        <div className="chat-input__group">
          <button aria-label="Attach context" className="btn-icon" type="button">
            <Plus size={18} strokeWidth={1.8} />
          </button>
        </div>
        <div className="chat-input__group">
          <button className="btn-ghost" type="button">
            Build
            <ChevronDown size={14} strokeWidth={1.8} />
          </button>
          <button aria-label="Voice input" className="btn-icon" type="button">
            <Mic size={18} strokeWidth={1.8} />
          </button>
          <button aria-label="Send prompt" className="chat-input__send" type="submit">
            <ArrowUp size={18} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </form>
  );
}
