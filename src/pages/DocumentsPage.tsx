import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionContext } from "../App";
import type { Route } from "../router";
import { listDocuments, type UploadedDocument } from "../api/applications";
import { ApiError } from "../api/client";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES, formatByteSize, validateDocumentFile, type DocumentType } from "../domain/documents";
import { IdempotencyKeyManager, defaultIdempotencyStore } from "../idempotency";
import { EmptyState, ErrorNotice, LoadingState } from "../components/feedback";

type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; documents: UploadedDocument[] };

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; fraction: number }
  | { kind: "failed"; message: string };

export function DocumentsPage({
  session,
  applicationId,
  navigate,
}: {
  session: SessionContext;
  applicationId: string;
  navigate: (route: Route) => void;
}) {
  const [listState, setListState] = useState<ListState>({ kind: "loading" });
  const [documentType, setDocumentType] = useState<DocumentType>("VESSEL_REGISTRATION");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // One idempotency key per (documentType, file name, file size) selection so
  // a retry of the same file after an ambiguous failure is deduplicated by
  // the server, while a genuinely new file gets a fresh key.
  const uploadKeys = useMemo(() => new Map<string, IdempotencyKeyManager>(), []);

  const load = useCallback(async () => {
    const client = await session.getClient();
    if (client === null) {
      return;
    }
    try {
      const documents = await listDocuments(client, applicationId);
      setListState({ kind: "ready", documents });
    } catch (error) {
      setListState({ kind: "error", message: error instanceof Error ? error.message : "documents could not be loaded" });
    }
  }, [session, applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  function keyForSelected(): IdempotencyKeyManager {
    const scope = file === null ? "none" : `${documentType}:${file.name}:${file.size}`;
    let manager = uploadKeys.get(scope);
    if (manager === undefined) {
      manager = new IdempotencyKeyManager(`upload.${applicationId}.${scope}`, defaultIdempotencyStore());
      uploadKeys.set(scope, manager);
    }
    return manager;
  }

  function onFileChosen(selected: File | null): void {
    setFile(selected);
    setUploadState({ kind: "idle" });
    if (selected === null) {
      setFileError(null);
      return;
    }
    setFileError(
      validateDocumentFile(selected, {
        maxBytes: session.configuration.cvff_api.max_document_bytes,
        contentTypes: session.configuration.cvff_api.document_content_types,
      }),
    );
  }

  async function upload(): Promise<void> {
    if (file === null || fileError !== null || uploadState.kind === "uploading") {
      return;
    }
    setUploadState({ kind: "uploading", fraction: 0 });
    const usable = await session.getClient();
    if (usable === null) {
      setUploadState({ kind: "idle" });
      return;
    }
    const keyManager = keyForSelected();
    const form = new FormData();
    form.set("document_type", documentType);
    form.set("file", file, file.name);
    try {
      await usable.postFormWithProgress<UploadedDocument>(
        `/applications/${encodeURIComponent(applicationId)}/documents`,
        form,
        keyManager.key(),
        (fraction) => setUploadState({ kind: "uploading", fraction }),
      );
      // Only a genuine 2xx reaches this line: now it is safe to show success.
      keyManager.rotate();
      setUploadState({ kind: "idle" });
      setFile(null);
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
      await load();
    } catch (error) {
      setUploadState({
        kind: "failed",
        message:
          error instanceof ApiError
            ? error.message
            : "The upload failed. The document was not recorded as uploaded; retry with the same file.",
      });
    }
  }

  return (
    <div className="space-y-4">
      <button className="button button--quiet" onClick={() => navigate({ name: "application-detail", applicationId })}>
        ← Back to application
      </button>

      <section className="card space-y-4">
        <div>
          <p className="eyebrow">Supporting documents</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-800">Upload evidence for application {applicationId}</h2>
          <p className="mt-1 text-sm text-slate-600">
            Approved formats: {session.configuration.cvff_api.document_content_types.join(", ")} — up to{" "}
            {(session.configuration.cvff_api.max_document_bytes / (1024 * 1024)).toFixed(0)} MB each. An upload is only
            marked complete when the CVFF service confirms it.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="field-label">Document type</span>
            <select className="field-select" value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentType)}>
              {DOCUMENT_TYPES.map((value) => (
                <option key={value} value={value}>{DOCUMENT_TYPE_LABELS[value]}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="field-label">File</span>
            <input
              ref={fileInputRef}
              className="field-input"
              type="file"
              accept={session.configuration.cvff_api.document_content_types.join(",")}
              onChange={(event) => onFileChosen(event.target.files?.item(0) ?? null)}
            />
            {fileError !== null && <p className="field-error">{fileError}</p>}
          </div>
        </div>

        {uploadState.kind === "uploading" && (
          <div aria-live="polite">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.round(uploadState.fraction * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-600">Uploading… {Math.round(uploadState.fraction * 100)}%</p>
          </div>
        )}

        {uploadState.kind === "failed" && (
          <div className="rounded border-l-4 border-l-red-800 bg-red-50 p-3" role="alert">
            <p className="text-sm text-red-900">{uploadState.message}</p>
            <p className="mt-1 text-xs text-red-800">
              Retrying reuses the same idempotency key, so the service will not record the document twice.
            </p>
          </div>
        )}

        <button className="button" disabled={file === null || fileError !== null || uploadState.kind === "uploading"} onClick={() => void upload()}>
          {uploadState.kind === "uploading" ? "Uploading…" : uploadState.kind === "failed" ? "Retry upload" : "Upload document"}
        </button>
      </section>

      <section className="card">
        <p className="eyebrow">Uploaded documents</p>
        {listState.kind === "loading" && <LoadingState message="Loading uploaded documents…" />}
        {listState.kind === "error" && <ErrorNotice message={listState.message} onRetry={() => void load()} />}
        {listState.kind === "ready" && listState.documents.length === 0 && (
          <EmptyState title="No documents uploaded yet">
            <p className="mt-1 text-sm text-slate-600">
              The CVFF service reports no documents for this application. Uploads appear here only after the service confirms them.
            </p>
          </EmptyState>
        )}
        {listState.kind === "ready" && listState.documents.length > 0 && (
          <ul className="mt-2 space-y-2">
            {listState.documents.map((document) => (
              <li key={document.document_id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-3 text-sm">
                <div>
                  <p className="font-medium text-slate-800">{DOCUMENT_TYPE_LABELS[document.document_type] ?? document.document_type}</p>
                  <p className="text-xs text-slate-500">
                    {document.file_name} · {formatByteSize(document.size_bytes)} · {document.content_type}
                  </p>
                </div>
                <span className="text-xs text-slate-500">Confirmed {new Date(document.uploaded_at).toLocaleString("en-NG")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
