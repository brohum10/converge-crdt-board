import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnId, MaterializedCard } from "../core/types";
import { SyncClient, type ConnectionState } from "./sync-client";
import "./styles.css";

const columns: { id: ColumnId; label: string; hint: string }[] = [
  { id: "backlog", label: "Backlog", hint: "Ideas waiting for a start" },
  { id: "progress", label: "In progress", hint: "Work moving right now" },
  { id: "done", label: "Done", hint: "Shipped and converged" },
];

const nextColumn: Record<ColumnId, ColumnId> = {
  backlog: "progress",
  progress: "done",
  done: "backlog",
};

function getActorId(): string {
  const existing = sessionStorage.getItem("converge:actor");
  if (existing) return existing;
  const id = `browser-${crypto.randomUUID().slice(0, 8)}`;
  sessionStorage.setItem("converge:actor", id);
  return id;
}

function Card({ card, client }: { card: MaterializedCard; client: SyncClient }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.title);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const title = draft.trim();
    if (title && title !== card.title) client.change(card.id, { title });
    setEditing(false);
  };

  return (
    <article className="card">
      <div className="card-topline">
        <span className="drag-mark" aria-hidden="true">••</span>
        <span className="card-id">{card.id.slice(0, 6)}</span>
      </div>
      {editing ? (
        <form className="edit-form" onSubmit={save}>
          <input aria-label={`Edit ${card.title}`} value={draft} maxLength={240} autoFocus onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" disabled={!draft.trim()}>Save</button>
        </form>
      ) : <h3>{card.title}</h3>}
      <div className="card-actions">
        <button onClick={() => client.change(card.id, { column: nextColumn[card.column] })}>
          Move <span aria-hidden="true">→</span>
        </button>
        <button onClick={() => { setDraft(card.title); setEditing((value) => !value); }}>{editing ? "Cancel" : "Edit"}</button>
        <button className="delete" onClick={() => client.change(card.id, { deleted: true })} aria-label="Delete card">
          ×
        </button>
      </div>
    </article>
  );
}

export default function App() {
  const [, redraw] = useState(0);
  const [status, setStatus] = useState<ConnectionState>("connecting");
  const [title, setTitle] = useState("");
  const clientRef = useRef<SyncClient | undefined>(undefined);

  if (!clientRef.current) {
    clientRef.current = new SyncClient("portfolio-demo", getActorId(), () => redraw((value) => value + 1), setStatus);
  }
  const client = clientRef.current;

  useEffect(() => {
    client.connect();
    return () => client.disconnect();
  }, [client]);

  const cards = client.cards();
  const byColumn = useMemo(
    () => Object.fromEntries(columns.map(({ id }) => [id, cards.filter((card) => card.column === id)])) as Record<ColumnId, MaterializedCard[]>,
    [cards],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    client.create(title);
    setTitle("");
  };

  return (
    <main>
      <nav>
        <a className="brand" href="#top" aria-label="Converge home">
          <span className="brand-mark"><i /><i /><i /></span>
          converge
        </a>
        <div className="nav-right">
          <span className={`status ${status}`}><i />{status}</span>
          <a href="https://github.com/brohum10/converge-crdt-board">View source ↗</a>
        </div>
      </nav>

      <header id="top">
        <div className="eyebrow">LOCAL-FIRST / REAL-TIME / CONFLICT-SAFE</div>
        <h1>Your work does not stop<br />when the network does.</h1>
        <p>
          Every edit lands locally first. Hybrid logical clocks and field-level CRDT registers resolve
          concurrent changes deterministically when collaborators reconnect.
        </p>
        <div className="proof-row">
          <span><b>{cards.length}</b> visible cards</span>
          <span><b>{client.pendingCount()}</b> pending operations</span>
          <span><b>O(1)</b> duplicate detection</span>
        </div>
      </header>

      <section className="workspace" aria-label="Collaborative project board">
        <div className="workspace-bar">
          <div>
            <span className="workspace-label">Shared workspace</span>
            <h2>Launch board</h2>
          </div>
          <div className="controls">
            <button className="network" onClick={() => status === "offline" ? client.reconnect() : client.disconnect()}>
              {status === "offline" ? "Reconnect" : "Go offline"}
            </button>
            <form onSubmit={submit}>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={240}
                placeholder="Add a task…"
                aria-label="New task title"
              />
              <button type="submit" disabled={!title.trim()}>Add card</button>
            </form>
          </div>
        </div>

        <div className="board">
          {columns.map((column) => (
            <section className="column" key={column.id}>
              <div className="column-heading">
                <div><span className={`dot ${column.id}`} /><h2>{column.label}</h2></div>
                <span>{byColumn[column.id].length.toString().padStart(2, "0")}</span>
              </div>
              <p>{column.hint}</p>
              <div className="card-list">
                {byColumn[column.id].map((card) => <Card card={card} client={client} key={card.id} />)}
                {byColumn[column.id].length === 0 && <div className="empty">No cards here yet</div>}
              </div>
            </section>
          ))}
        </div>
      </section>

      <footer>
        <span>Built by Soham Jindal</span>
        <span>Open two tabs, disconnect one, edit both, and watch them converge.</span>
      </footer>
    </main>
  );
}
