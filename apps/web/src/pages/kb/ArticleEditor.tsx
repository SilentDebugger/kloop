import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Button, Chip, ErrorNote, Input, SectionLabel, Spinner } from "../../ui";
import { MediaQueryBar, useComposerAttachments } from "../../ui/attachments";
import { IconPlus, IconX } from "../../ui/icons";
import { BackBar } from "../shared/BackBar";

type EditableBlock = { kind: "symptoms" | "environment" | "resolution" | "notes"; contentMd: string; conditionText: string };

const KINDS: EditableBlock["kind"][] = ["symptoms", "environment", "resolution", "notes"];
const kindLabels: Record<EditableBlock["kind"], string> = {
  symptoms: "Symptoms",
  environment: "Environment",
  resolution: "Resolution steps",
  notes: "Notes",
};

/** Block-based article editor — used for both new articles and edits. */
export function ArticleEditorPage() {
  const { id } = useParams<{ id?: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["article", id],
    queryFn: () => api.article(id!),
    enabled: !isNew,
  });

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [blocks, setBlocks] = useState<EditableBlock[]>([
    { kind: "symptoms", contentMd: "", conditionText: "" },
    { kind: "resolution", contentMd: "", conditionText: "" },
  ]);
  const [changeNote, setChangeNote] = useState("");
  const [loaded, setLoaded] = useState(false);
  const att = useComposerAttachments(); // new uploads — vectorized and searchable once saved
  const [removedAtt, setRemovedAtt] = useState<string[]>([]);
  const existingAtt = (data?.attachments ?? []).filter((a) => !removedAtt.includes(a.id));

  useEffect(() => {
    if (data && !loaded) {
      setTitle(data.article.title);
      setSummary(data.article.summary ?? "");
      setTags(data.article.tags);
      setBlocks(
        data.blocks.map((b) => ({ kind: b.kind, contentMd: b.contentMd, conditionText: b.conditionText ?? "" })),
      );
      setLoaded(true);
    }
  }, [data, loaded]);

  const save = useMutation({
    mutationFn: (): Promise<unknown> => {
      const payload = {
        title: title.trim(),
        summary: summary.trim(),
        tags,
        blocks: blocks
          .filter((b) => b.contentMd.trim())
          .map((b) => ({ kind: b.kind, contentMd: b.contentMd.trim(), conditionText: b.conditionText.trim() || null })),
        attachmentIds: att.ids,
        publish: true,
      };
      return isNew
        ? api.createArticle(payload)
        : api.updateArticle(id!, { ...payload, removeAttachmentIds: removedAtt, changeNote: changeNote.trim() || undefined });
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["articles"] });
      void qc.invalidateQueries({ queryKey: ["article", id] });
      navigate(isNew ? `/kb/${(res as { article: { id: string } }).article.id}` : `/kb/${id}`, { replace: true });
    },
  });

  if (!isNew && (isLoading || !data)) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner size={26} />
      </div>
    );
  }

  const canSave = title.trim().length >= 3 && blocks.some((b) => b.contentMd.trim()) && !att.uploading;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-32 pt-4">
      <BackBar title={isNew ? "New article" : `Edit · ${data?.article.kb}`} />

      <div className="mt-5 flex flex-col gap-3">
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="font-semibold" />
        <Input placeholder="One-line summary" value={summary} onChange={(e) => setSummary(e.target.value)} />

        {/* tags */}
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tg) => (
            <span key={tg} className="inline-flex items-center gap-1.5 rounded-full bg-chip px-3 py-1 text-[13px] font-medium">
              {tg}
              <button onClick={() => setTags(tags.filter((x) => x !== tg))} className="cursor-pointer" aria-label="Remove tag">
                <IconX size={13} />
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                e.preventDefault();
                if (!tags.includes(tagInput.trim())) setTags([...tags, tagInput.trim()]);
                setTagInput("");
              }
            }}
            placeholder="Add tag ⏎"
            className="w-24 bg-transparent px-2 py-1 text-[13px] outline-none placeholder:text-ink-faint"
          />
        </div>

        {/* blocks */}
        {blocks.map((b, i) => (
          <div key={i} className="rounded-card bg-card p-4 shadow-card">
            <div className="flex items-center justify-between">
              <select
                value={b.kind}
                onChange={(e) => update(i, { kind: e.target.value as EditableBlock["kind"] })}
                className="section-label cursor-pointer bg-transparent outline-none"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {kindLabels[k]}
                  </option>
                ))}
              </select>
              <button onClick={() => setBlocks(blocks.filter((_, j) => j !== i))} className="text-ink-faint cursor-pointer" aria-label="Remove block">
                <IconX size={15} />
              </button>
            </div>
            <input
              value={b.conditionText}
              onChange={(e) => update(i, { conditionText: e.target.value })}
              placeholder="Condition (optional) — e.g. 'macOS 14.4+'"
              className="mt-1 w-full bg-transparent text-[13px] font-semibold text-primary outline-none placeholder:font-normal placeholder:text-ink-faint"
            />
            <textarea
              rows={4}
              value={b.contentMd}
              onChange={(e) => update(i, { contentMd: e.target.value })}
              placeholder="Markdown content…"
              className="mt-1.5 w-full resize-y bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-ink-faint"
            />
          </div>
        ))}

        <button
          onClick={() => setBlocks([...blocks, { kind: "notes", contentMd: "", conditionText: "" }])}
          className="flex items-center justify-center gap-2 rounded-card border-2 border-dashed border-line py-3 text-[14px] font-semibold text-ink-secondary transition-colors hover:border-primary hover:text-primary cursor-pointer"
        >
          <IconPlus size={16} /> Add block
        </button>

        {/* media: screenshots + voice notes, vectorized so search finds them */}
        <SectionLabel className="mt-2">Media</SectionLabel>
        {existingAtt.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {existingAtt.map((a) => (
              <span key={a.id} className="relative">
                {a.kind === "image" ? (
                  <img src={api.attachmentRawUrl(a.id)} alt={a.filename} className="h-16 w-16 rounded-xl object-cover" />
                ) : a.kind === "audio" ? (
                  <audio controls src={api.attachmentRawUrl(a.id)} className="h-9 max-w-56" />
                ) : (
                  <span className="inline-flex items-center rounded-full bg-chip px-3 py-1 text-[12px] font-medium">{a.filename}</span>
                )}
                <button
                  onClick={() => setRemovedAtt((x) => [...x, a.id])}
                  aria-label="Remove"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white cursor-pointer"
                >
                  <IconX size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="-mt-2">
          <MediaQueryBar att={att} />
        </div>

        {!isNew && (
          <>
            <SectionLabel className="mt-2">Change note</SectionLabel>
            <Input
              placeholder="What changed and why? (shown in revision history)"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
            />
          </>
        )}

        {save.isError && <ErrorNote>{(save.error as Error).message}</ErrorNote>}

        <div className="mt-2 flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button className="flex-[2]" disabled={!canSave} loading={save.isPending} onClick={() => save.mutate()}>
            {isNew ? "Publish article" : "Save & publish revision"}
          </Button>
        </div>
      </div>
    </div>
  );

  function update(i: number, patch: Partial<EditableBlock>) {
    setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }
}
