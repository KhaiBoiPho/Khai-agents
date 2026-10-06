import { X } from "lucide-react";
import { useId, useState } from "react";

import { tagHue, tagKey } from "./taskModel";

import styles from "./TaskDetail.module.css";

/** Enter or comma confirms; Backspace on an empty field takes the last tag back. */
export function TagEditor({
  tags,
  suggestions,
  onChange,
}: {
  tags: string[];
  suggestions: string[];
  onChange(tags: string[]): void;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const own = tags.map(tagKey);
  const offered = suggestions.filter((tag) => !own.includes(tagKey(tag)));

  const commit = (value: string) => {
    const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length) onChange([...tags, ...parts]);
    setDraft("");
  };

  return (
    <div className={styles.tagEditor}>
      {tags.map((tag) => (
        <span key={tag} className={styles.tagToken} data-hue={tagHue(tag)}>
          {tag}
          <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter((entry) => entry !== tag))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        list={listId}
        placeholder={tags.length ? "" : "Add tags"}
        aria-label="Add a tag"
        onChange={(event) => {
          const value = event.target.value;
          if (value.includes(",")) commit(value);
          else setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(draft);
          } else if (event.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
      />
      <datalist id={listId}>
        {offered.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </div>
  );
}
