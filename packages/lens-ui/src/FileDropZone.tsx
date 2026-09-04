import { useId, useState, type DragEvent } from "react";

interface FileDropZoneProps {
  label: string;
  fileName?: string;
  disabled?: boolean;
  onFile(file: File): void;
}

export function FileDropZone({
  label,
  fileName,
  disabled = false,
  onFile,
}: FileDropZoneProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  function receiveDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files.item(0);
    if (file) onFile(file);
  }

  return (
    <label
      className={`file-drop${dragging ? " is-dragging" : ""}${fileName ? " has-file" : ""}`}
      htmlFor={inputId}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={receiveDrop}
    >
      <input
        id={inputId}
        type="file"
        accept=".hwpx,application/zip"
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.item(0);
          if (file) onFile(file);
          event.currentTarget.value = "";
        }}
      />
      <span className="file-drop__eyebrow">{label}</span>
      <span className="file-drop__name">{fileName ?? "HWPX를 놓거나 선택"}</span>
      <span className="file-drop__action">{fileName ? "파일 바꾸기" : "로컬 파일 열기"}</span>
    </label>
  );
}
