import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHANGE_SET_PRIVACY_WARNING,
  buildReviewInkModel,
  documentAnalysisKey,
  pairAnalysisKey,
  sha256Hex,
} from "@hwpx-lens/lens-core";
import type {
  Change,
  DiffAdapter,
  DocumentAnchor,
  DocumentComplexityProfile,
  DocumentSnapshot,
  LensDocument,
  OpenDocument,
  ReviewInkGeometry,
  VisualTarget,
} from "@hwpx-lens/lens-core";
import {
  SessionAnalysisCache,
  type CachedChangeTargets,
} from "./analysis-cache";
import {
  prepareChangeSetExport,
  type ChangeSetGeneratorInfo,
  type SaveChangeSetFile,
} from "./change-set-export";
import {
  changeCategory,
  changesInScope,
  countChanges,
  type ChangeFilter,
} from "./ChangesPanel";
import { DetachableWorkspace } from "./DetachableWorkspace";
import { DocumentViewer } from "./DocumentViewer";
import { FileDropZone } from "./FileDropZone";
import { readValidatedHwpx } from "./file-validation";
import { materializeReviewInk } from "./review-ink-geometry";
import {
  ReviewWorkspace,
  type DetachedReviewWorkspaceState,
  type ReviewWorkspaceAction,
  type ReviewWorkspaceTab,
} from "./ReviewWorkspace";
import {
  buildStructureTree,
  flattenStructure,
  structureNodeForChange,
  type StructureNode,
} from "./StructurePanel";
import type { ProductProfile } from "./profiles";

type Side = "original" | "modified";
type LoadStatus = "empty" | "loading" | "ready" | "error";
type LoadStage = "reading" | "fingerprinting" | "opening" | "snapshot" | "cache-hit";

interface LoadTimings {
  validationMs: number;
  fingerprintMs: number;
  openMs: number;
  snapshotMs: number;
  totalMs: number;
  snapshotCacheHit: boolean;
}

interface LoadedSide {
  status: LoadStatus;
  stage?: LoadStage;
  fileName?: string;
  sourceFile?: File;
  document?: LensDocument;
  snapshot?: DocumentSnapshot;
  complexity?: DocumentComplexityProfile;
  analysisKey?: string;
  timings?: LoadTimings;
  error?: string;
}

interface LocatedTarget {
  target?: VisualTarget;
  contextual: boolean;
}

interface AnalysisProgress {
  phase: "idle" | "comparing" | "mapping" | "ready";
  label: string;
  current?: number;
  total?: number;
}

interface AnalysisPerformanceReport {
  originalLoadMs: number;
  modifiedLoadMs: number;
  diffMs: number;
  mappingMs: number;
  totalMs: number;
  snapshotCacheHits: number;
  pairCacheHit: boolean;
}

interface LensAppProps {
  openDocument: OpenDocument;
  diffAdapter: DiffAdapter;
  renderCachePages?: number;
  productProfile: ProductProfile;
  changeSetGenerator?: ChangeSetGeneratorInfo;
  saveChangeSetFile?: SaveChangeSetFile;
}

interface ReviewInkBySide {
  original: ReviewInkGeometry[];
  modified: ReviewInkGeometry[];
}

const EMPTY_SIDE: LoadedSide = { status: "empty" };

export function LensApp({
  openDocument,
  diffAdapter,
  renderCachePages = 5,
  productProfile,
  changeSetGenerator,
  saveChangeSetFile,
}: LensAppProps) {
  const [original, setOriginal] = useState<LoadedSide>(EMPTY_SIDE);
  const [modified, setModified] = useState<LoadedSide>(EMPTY_SIDE);
  const [changes, setChanges] = useState<Change[]>([]);
  const [changeTargets, setChangeTargets] = useState<Map<string, CachedChangeTargets>>(
    () => new Map(),
  );
  const [reviewInk, setReviewInk] = useState<ReviewInkBySide>({
    original: [],
    modified: [],
  });
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [reviewTab, setReviewTab] = useState<ReviewWorkspaceTab>("changes");
  const [activeStructureId, setActiveStructureId] = useState<string>();
  const [structureScopeId, setStructureScopeId] = useState<string>();
  const [workspaceDetached, setWorkspaceDetached] = useState(false);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const [navigationMode, setNavigationMode] = useState<"change" | "structure">("change");
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress>({
    phase: "idle",
    label: `${productProfile.pairNoun}를 선택하세요.`,
  });
  const [performanceReport, setPerformanceReport] = useState<AnalysisPerformanceReport>();
  const [exportState, setExportState] = useState<{
    status: "idle" | "preparing" | "saving" | "saved" | "cancelled" | "error";
    message?: string;
  }>({ status: "idle" });
  const [targets, setTargets] = useState<{ original: LocatedTarget; modified: LocatedTarget }>({
    original: { contextual: false },
    modified: { contextual: false },
  });
  const loadGeneration = useRef({ original: 0, modified: 0 });
  const analysisCache = useRef(new SessionAnalysisCache());

  async function load(side: Side, file: File) {
    const generation = ++loadGeneration.current[side];
    const setSide = side === "original" ? setOriginal : setModified;
    const current = side === "original" ? original : modified;
    current.document?.dispose();
    const pipelineStartedAt = performance.now();
    setSide({ status: "loading", stage: "reading", fileName: file.name });

    try {
      const validated = await measure(() => readValidatedHwpx(file));
      if (loadGeneration.current[side] !== generation) return;
      setSide({ status: "loading", stage: "fingerprinting", fileName: file.name });
      const fingerprinted = await measure(() => sha256Hex(validated.value));
      if (loadGeneration.current[side] !== generation) return;
      setSide({ status: "loading", stage: "opening", fileName: file.name });
      await yieldToBrowser();
      const opened = await measure(() => openDocument(validated.value));
      const document = opened.value;
      if (loadGeneration.current[side] !== generation) {
        document.dispose();
        return;
      }

      const key = documentAnalysisKey(fingerprinted.value, document.analysisIdentity);
      const cached = analysisCache.current.getDocument(key);
      let snapshot: DocumentSnapshot;
      let complexity: DocumentComplexityProfile;
      let snapshotMs = 0;
      if (cached) {
        setSide({ status: "loading", stage: "cache-hit", fileName: file.name });
        snapshot = cached.snapshot;
        complexity = cached.complexity;
      } else {
        setSide({ status: "loading", stage: "snapshot", fileName: file.name });
        await yieldToBrowser();
        const snapshotted = await measure(() => document.createSnapshot());
        snapshot = snapshotted.value;
        snapshotMs = snapshotted.durationMs;
        complexity = await document.complexityProfile();
        analysisCache.current.setDocument(key, { snapshot, complexity });
      }
      if (loadGeneration.current[side] !== generation) {
        document.dispose();
        return;
      }
      setSide({
        status: "ready",
        fileName: file.name,
        sourceFile: file,
        document,
        snapshot,
        complexity,
        analysisKey: key,
        timings: {
          validationMs: validated.durationMs,
          fingerprintMs: fingerprinted.durationMs,
          openMs: opened.durationMs,
          snapshotMs,
          totalMs: Number((performance.now() - pipelineStartedAt).toFixed(3)),
          snapshotCacheHit: Boolean(cached),
        },
      });
    } catch (caught) {
      if (loadGeneration.current[side] !== generation) return;
      setSide({
        status: "error",
        fileName: file.name,
        error: caught instanceof Error ? caught.message : "문서를 열지 못했습니다.",
      });
    }
  }

  useEffect(() => {
    if (
      !original.snapshot ||
      !modified.snapshot ||
      !original.document ||
      !modified.document ||
      !original.analysisKey ||
      !modified.analysisKey
    ) {
      setChanges([]);
      setChangeTargets(new Map());
      setReviewInk({ original: [], modified: [] });
      setSelectedIndex(0);
      setPerformanceReport(undefined);
      return;
    }

    let active = true;
    const pairStartedAt = performance.now();
    const key = pairAnalysisKey(
      original.analysisKey,
      modified.analysisKey,
      diffAdapter.analysisIdentity,
    );
    setComparing(true);
    setAnalysisProgress({ phase: "comparing", label: "본문 변경을 비교하고 있습니다." });

    void (async () => {
      const cached = analysisCache.current.getPair(key);
      if (cached) {
        await yieldToBrowser();
        if (!active) return;
        setChanges(cached.changes);
        setChangeTargets(new Map(cached.targets));
        setReviewInk(cached.reviewInk);
        setSelectedIndex(0);
        setComparing(false);
        setAnalysisProgress({ phase: "ready", label: `${cached.changes.length}개 변경 준비 완료` });
        setPerformanceReport({
          originalLoadMs: original.timings?.totalMs ?? 0,
          modifiedLoadMs: modified.timings?.totalMs ?? 0,
          diffMs: 0,
          mappingMs: 0,
          totalMs: Number((performance.now() - pairStartedAt).toFixed(3)),
          snapshotCacheHits: Number(original.timings?.snapshotCacheHit) +
            Number(modified.timings?.snapshotCacheHit),
          pairCacheHit: true,
        });
        return;
      }

      // Let React paint the comparison phase before CPU-bound alignment starts.
      await yieldToBrowser();
      if (!active) return;
      const compared = await measure(() => diffAdapter.compare(original.snapshot!, modified.snapshot!));
      if (!active) return;
      setAnalysisProgress({
        phase: "mapping",
        label: "변경 위치를 연결하고 있습니다.",
        current: 0,
        total: compared.value.length,
      });
      const mapped = await measure(() => mapChangeReviewData(
        compared.value,
        original.document!,
        modified.document!,
        (current, total) => {
          if (active) {
            setAnalysisProgress({
              phase: "mapping",
              label: "변경 위치를 연결하고 있습니다.",
              current,
              total,
            });
          }
        },
        () => active,
      ));
      if (!active) return;
      const result = {
        changes: compared.value,
        targets: mapped.value.targets,
        reviewInk: mapped.value.reviewInk,
        diffMs: compared.durationMs,
        mappingMs: mapped.durationMs,
      };
      analysisCache.current.setPair(key, result);
      setChanges(result.changes);
      setChangeTargets(new Map(result.targets));
      setReviewInk(result.reviewInk);
      setSelectedIndex(0);
      setComparing(false);
      setAnalysisProgress({ phase: "ready", label: `${result.changes.length}개 변경 준비 완료` });
      setPerformanceReport({
        originalLoadMs: original.timings?.totalMs ?? 0,
        modifiedLoadMs: modified.timings?.totalMs ?? 0,
        diffMs: result.diffMs,
        mappingMs: result.mappingMs,
        totalMs: Number((performance.now() - pairStartedAt).toFixed(3)),
        snapshotCacheHits: Number(original.timings?.snapshotCacheHit) +
          Number(modified.timings?.snapshotCacheHit),
        pairCacheHit: false,
      });
    })().catch(() => {
      if (!active) return;
      setChanges([]);
      setChangeTargets(new Map());
      setComparing(false);
      setAnalysisProgress({ phase: "idle", label: "변경 분석을 완료하지 못했습니다." });
    });
    return () => { active = false; };
  }, [diffAdapter, modified, original]);

  const structure = useMemo(
    () => buildStructureTree(original.snapshot, modified.snapshot, changes),
    [changes, modified.snapshot, original.snapshot],
  );
  const flatStructure = useMemo(() => flattenStructure(structure), [structure]);
  const structureScope = useMemo(
    () => flatStructure.find((node) => node.id === structureScopeId),
    [flatStructure, structureScopeId],
  );
  const scopedChanges = useMemo(
    () => changesInScope(changes, structureScope?.changeIds),
    [changes, structureScope],
  );
  const visibleChanges = useMemo(
    () => scopedChanges.filter((change) =>
      changeFilter === "all" || changeCategory(change, productProfile) === changeFilter,
    ),
    [changeFilter, productProfile, scopedChanges],
  );
  const selectedChange = visibleChanges[selectedIndex];
  const selectedReviewInkSides = useMemo(() => new Set(
    selectedChange ? buildReviewInkModel([selectedChange]).map((item) => item.side) : [],
  ), [selectedChange]);
  const visibleReviewInk = useMemo(() => {
    const ids = new Set(visibleChanges.map((change) => change.id));
    return {
      original: reviewInk.original.filter((item) => ids.has(item.changeId)),
      modified: reviewInk.modified.filter((item) => ids.has(item.changeId)),
    };
  }, [reviewInk, visibleChanges]);
  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(visibleChanges.length - 1, 0)));
  }, [visibleChanges.length]);
  useEffect(() => {
    if (!selectedChange) return;
    const node = structureNodeForChange(structure, selectedChange.id);
    if (node) setActiveStructureId(node.id);
  }, [selectedChange, structure]);
  useEffect(() => {
    let active = true;
    if (!original.document || !modified.document) {
      setTargets({ original: { contextual: false }, modified: { contextual: false } });
      return;
    }
    if (navigationMode === "structure") {
      const selectedStructure = flatStructure.find((node) => node.id === activeStructureId);
      if (!selectedStructure) {
        setTargets({ original: { contextual: false }, modified: { contextual: false } });
        return;
      }
      void Promise.all([
        locate(original.document, selectedStructure.originalAnchor, false),
        locate(modified.document, selectedStructure.modifiedAnchor, false),
      ]).then(([originalTarget, modifiedTarget]) => {
        if (active) setTargets({ original: originalTarget, modified: modifiedTarget });
      });
      return () => { active = false; };
    }
    if (!selectedChange) {
      setTargets({ original: { contextual: false }, modified: { contextual: false } });
      return;
    }
    const cached = changeTargets.get(selectedChange.id);
    if (cached) {
      setTargets(cached);
      return;
    }

    const originalAnchor = selectedChange.originalAnchor ?? selectedChange.originalContextAnchor;
    const modifiedAnchor = selectedChange.modifiedAnchor ?? selectedChange.modifiedContextAnchor;
    void Promise.all([
      locate(original.document, originalAnchor, !selectedChange.originalAnchor),
      locate(modified.document, modifiedAnchor, !selectedChange.modifiedAnchor),
    ]).then(([originalTarget, modifiedTarget]) => {
      if (active) setTargets({ original: originalTarget, modified: modifiedTarget });
    });
    return () => { active = false; };
  }, [activeStructureId, changeTargets, flatStructure, modified.document, navigationMode, navigationRevision, original.document, selectedChange]);

  useEffect(() => () => original.document?.dispose(), [original.document]);
  useEffect(() => () => modified.document?.dispose(), [modified.document]);
  useEffect(() => () => analysisCache.current.clear(), []);

  const documentsReady = original.status === "ready" && modified.status === "ready";
  const ready = documentsReady && !comparing;
  const analyzing = comparing || original.status === "loading" || modified.status === "loading";
  const changeCounts = useMemo(
    () => countChanges(scopedChanges, productProfile),
    [productProfile, scopedChanges],
  );
  const globalChangeCounts = useMemo(
    () => countChanges(changes, productProfile),
    [changes, productProfile],
  );
  const hasLargeDocument = original.complexity?.level === "high" || modified.complexity?.level === "high";
  const summary = useMemo(() => {
    if (original.status === "loading") return loadStageLabel("Original", original.stage);
    if (modified.status === "loading") return loadStageLabel("Modified", modified.stage);
    if (!documentsReady) return `${productProfile.pairNoun}를 불러오면 변경 위치를 나란히 보여드립니다.`;
    if (comparing) return progressLabel(analysisProgress);
    const suffix = hasLargeDocument ? " · 대용량 문서 보호 모드" : "";
    const specialTableSummary = productProfile.specialTableCategory
      ? ` · ${productProfile.specialTableCategory.summaryLabel} ${globalChangeCounts["special-table"]}`
      : "";
    return changes.length
      ? `변경 ${changes.length}건을 찾았습니다. (본문 ${globalChangeCounts.text} · 띄어쓰기 ${globalChangeCounts.whitespace} · 개요 ${globalChangeCounts.outline}${specialTableSummary} · 표 ${globalChangeCounts.table} · 캡션 이미지 ${globalChangeCounts["captioned-image"]} · 기타 이미지 ${globalChangeCounts["other-image"]})${suffix}`
      : `본문 텍스트와 표 변경을 찾지 못했습니다.${suffix}`;
  }, [
    analysisProgress,
    globalChangeCounts.table,
    globalChangeCounts["captioned-image"],
    globalChangeCounts["other-image"],
    globalChangeCounts.text,
    globalChangeCounts.whitespace,
    globalChangeCounts.outline,
    globalChangeCounts["special-table"],
    changes.length,
    comparing,
    documentsReady,
    hasLargeDocument,
    modified.stage,
    modified.status,
    original.stage,
    original.status,
    productProfile,
  ]);

  const detachedWorkspaceState = useMemo<DetachedReviewWorkspaceState>(() => ({
    tab: reviewTab,
    structure,
    selectedStructureId: activeStructureId,
    structureRevealKey: navigationRevision,
    structureScoped: structureScopeId !== undefined,
    changes: visibleChanges,
    counts: changeCounts,
    filter: changeFilter,
    selectedIndex,
    comparing: analyzing,
    analysisMessage: analysisMessage(original, modified, analysisProgress),
    ready,
    productProfile,
  }), [
    activeStructureId,
    analysisProgress,
    analyzing,
    changeCounts,
    changeFilter,
    modified,
    navigationRevision,
    original,
    productProfile,
    ready,
    reviewTab,
    selectedIndex,
    structure,
    structureScopeId,
    visibleChanges,
  ]);

  useEffect(() => {
    if (!workspaceDetached) return;
    window.dispatchEvent(new CustomEvent("hwpx-lens:workspace-state", {
      detail: detachedWorkspaceState,
    }));
  }, [detachedWorkspaceState, workspaceDetached]);

  useEffect(() => {
    const handleAction = (event: Event) => {
      const action = (event as CustomEvent<ReviewWorkspaceAction>).detail;
      if (!action) return;
      if (action.type === "tab") setReviewTab(action.tab);
      else if (action.type === "structure") {
        const node = flatStructure.find((candidate) => candidate.id === action.nodeId);
        if (node) selectStructure(node);
      } else if (action.type === "clear-structure") clearStructureScope();
      else if (action.type === "change") selectChange(action.index);
      else if (action.type === "filter") selectFilter(action.filter);
      else if (action.type === "previous") moveSelection(-1);
      else if (action.type === "next") moveSelection(1);
      else if (action.type === "close") setWorkspaceDetached(false);
    };
    window.addEventListener("hwpx-lens:workspace-action", handleAction);
    return () => window.removeEventListener("hwpx-lens:workspace-action", handleAction);
  }, [flatStructure, visibleChanges.length]);

  function moveSelection(delta: number) {
    if (visibleChanges.length === 0) return;
    setNavigationMode("change");
    setNavigationRevision((value) => value + 1);
    setSelectedIndex(
      (current) => (current + delta + visibleChanges.length) % visibleChanges.length,
    );
  }

  function selectFilter(filter: ChangeFilter) {
    setNavigationMode("change");
    setNavigationRevision((value) => value + 1);
    setChangeFilter(filter);
    setSelectedIndex(0);
  }

  function selectChange(index: number) {
    setNavigationMode("change");
    setNavigationRevision((value) => value + 1);
    setSelectedIndex(index);
  }

  function selectStructure(node: StructureNode) {
    setNavigationMode("structure");
    setNavigationRevision((value) => value + 1);
    setActiveStructureId(node.id);
    setStructureScopeId(node.id);
    setChangeFilter("all");
    setSelectedIndex(0);
  }

  function clearStructureScope() {
    setNavigationMode("change");
    setStructureScopeId(undefined);
    setSelectedIndex(0);
    setNavigationMode("change");
  }

  function resetDocuments() {
    loadGeneration.current.original += 1;
    loadGeneration.current.modified += 1;
    original.document?.dispose();
    modified.document?.dispose();
    setOriginal(EMPTY_SIDE);
    setModified(EMPTY_SIDE);
    setChanges([]);
    setChangeTargets(new Map());
    setReviewInk({ original: [], modified: [] });
    setActiveStructureId(undefined);
    setStructureScopeId(undefined);
    setSelectedIndex(0);
    setExportState({ status: "idle" });
    setAnalysisProgress({ phase: "idle", label: `${productProfile.pairNoun}를 선택하세요.` });
  }

  async function exportChangeSet() {
    if (
      !ready || !original.sourceFile || !modified.sourceFile ||
      !original.snapshot || !modified.snapshot || !changeSetGenerator || !saveChangeSetFile
    ) return;
    if (!window.confirm(CHANGE_SET_PRIVACY_WARNING)) {
      setExportState({ status: "cancelled", message: "내보내기를 취소했습니다." });
      return;
    }

    // Capture one completed comparison before any asynchronous file/save work.
    const exportSnapshot = {
      originalFile: original.sourceFile,
      modifiedFile: modified.sourceFile,
      originalSnapshot: original.snapshot,
      modifiedSnapshot: modified.snapshot,
      changes: [...changes],
    };
    try {
      setExportState({ status: "preparing", message: "Change Set을 검증하고 있습니다." });
      const prepared = await prepareChangeSetExport({
        ...exportSnapshot,
        supportedTypes: diffAdapter.supportedTypes,
        analysisIdentity: [
          `diff:${diffAdapter.analysisIdentity}`,
          `original:${original.document?.analysisIdentity ?? "unavailable"}`,
          `modified:${modified.document?.analysisIdentity ?? "unavailable"}`,
        ].join("|"),
        productProfile: productProfile.id,
        generator: changeSetGenerator,
      });
      setExportState({ status: "saving", message: "저장 위치를 선택하세요." });
      const result = await saveChangeSetFile({
        contents: prepared.json,
        defaultFileName: prepared.defaultFileName,
      });
      setExportState(result === "saved"
        ? { status: "saved", message: "Change Set JSON을 저장했습니다." }
        : { status: "cancelled", message: "저장을 취소했습니다." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Change Set JSON을 저장하지 못했습니다.";
      setExportState({ status: "error", message });
    }
  }

  const closeDetached = useCallback(() => setWorkspaceDetached(false), []);

  const reviewWorkspace = (detached = false) => (
    <ReviewWorkspace
      detached={detached}
      collapsed={!detached && workspaceCollapsed}
      tab={reviewTab}
      structure={structure}
      selectedStructureId={activeStructureId}
      structureRevealKey={navigationRevision}
      structureScoped={structureScopeId !== undefined}
      changes={visibleChanges}
      counts={changeCounts}
      filter={changeFilter}
      selectedIndex={selectedIndex}
      comparing={analyzing}
      analysisMessage={analysisMessage(original, modified, analysisProgress)}
      ready={ready}
      productProfile={productProfile}
      onTabChange={setReviewTab}
      onStructureSelect={selectStructure}
      onStructureClear={clearStructureScope}
      onChangeSelect={selectChange}
      onFilterChange={selectFilter}
      onPrevious={() => moveSelection(-1)}
      onNext={() => moveSelection(1)}
      onDetachToggle={() => setWorkspaceDetached(!detached)}
      onCollapseToggle={detached ? undefined : () => setWorkspaceCollapsed((value) => !value)}
    />
  );

  return (
    <main
      className="lens-app"
      data-analysis-phase={analysisProgress.phase}
      data-analysis-report={performanceReport ? JSON.stringify(performanceReport) : undefined}
      data-analysis-cache-persistent="false"
      data-product-profile={productProfile.id}
    >
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <div>
          <div className="app-title-row">
            <h1>HWPX Lens</h1>
            <span className={`product-profile-badge product-profile-badge--${productProfile.id}`}>
              {productProfile.displayName}
            </span>
          </div>
          <p>{summary}</p>
        </div>
        <div className="app-header__actions">
          <div className="change-set-export-control">
            <button
              type="button"
              className="export-change-set"
              disabled={!ready || !changeSetGenerator || !saveChangeSetFile || exportState.status === "preparing" || exportState.status === "saving"}
              onClick={() => void exportChangeSet()}
              title="비교 사실과 전체 목차 대응표를 JSON으로 저장"
            >
              {exportState.status === "preparing" || exportState.status === "saving"
                ? "내보내는 중…"
                : "Change Set JSON 내보내기"}
            </button>
            {exportState.message && (
              <span
                className={`change-set-export-status change-set-export-status--${exportState.status}`}
                role={exportState.status === "error" ? "alert" : "status"}
              >
                {exportState.message}
              </span>
            )}
          </div>
          <button type="button" className="reset-documents" onClick={resetDocuments}>초기화</button>
          <span className="offline-badge"><i /> OFFLINE</span>
        </div>
      </header>

      <section className="file-bar" aria-label="비교할 문서 선택">
        <FileDropZone
          label="ORIGINAL"
          fileName={original.fileName}
          disabled={original.status === "loading"}
          onFile={(file) => void load("original", file)}
        />
        <div className="compare-symbol" aria-hidden="true">⇄</div>
        <FileDropZone
          label="MODIFIED"
          fileName={modified.fileName}
          disabled={modified.status === "loading"}
          onFile={(file) => void load("modified", file)}
        />
      </section>

      <section className="workspace">
        {workspaceDetached ? (
          <aside className="detached-placeholder" aria-label="분리된 검토 작업공간">
            <span>Review Workspace가 분리되어 있습니다.</span>
            <button type="button" onClick={closeDetached}>본창으로 복귀</button>
          </aside>
        ) : reviewWorkspace()}
        <div className="viewer-grid">
          <DocumentViewer
            label="ORIGINAL"
            fileName={original.fileName}
            rendering={original.document?.rendering}
            interaction={original.document?.interaction}
            status={original.status}
            error={original.error}
            target={targets.original.target}
            navigationMode={navigationMode === "structure" ? "page" : "target"}
            navigationKey={navigationRevision}
            contextual={targets.original.contextual}
            reviewInk={visibleReviewInk.original}
            activeChangeId={selectedChange?.id}
            suppressLegacyHighlight={
              selectedChange?.type !== "table" && !selectedReviewInkSides.has("original")
            }
            renderCachePages={renderCachePages}
          />
          <DocumentViewer
            label="MODIFIED"
            fileName={modified.fileName}
            rendering={modified.document?.rendering}
            interaction={modified.document?.interaction}
            status={modified.status}
            error={modified.error}
            target={targets.modified.target}
            navigationMode={navigationMode === "structure" ? "page" : "target"}
            navigationKey={navigationRevision}
            contextual={targets.modified.contextual}
            reviewInk={visibleReviewInk.modified}
            activeChangeId={selectedChange?.id}
            suppressLegacyHighlight={
              selectedChange?.type !== "table" && !selectedReviewInkSides.has("modified")
            }
            renderCachePages={renderCachePages}
          />
        </div>
      </section>
      <DetachableWorkspace open={workspaceDetached} onClose={closeDetached}>
        {reviewWorkspace(true)}
      </DetachableWorkspace>
    </main>
  );
}

async function mapChangeReviewData(
  changes: Change[],
  original: LensDocument,
  modified: LensDocument,
  onProgress: (current: number, total: number) => void,
  isActive: () => boolean,
): Promise<{ targets: Map<string, CachedChangeTargets>; reviewInk: ReviewInkBySide }> {
  const targets = new Map<string, CachedChangeTargets>();
  const reviewInk: ReviewInkBySide = { original: [], modified: [] };
  for (let index = 0; index < changes.length; index += 1) {
    if (!isActive()) break;
    const change = changes[index];
    const originalAnchor = change.originalAnchor ?? change.originalContextAnchor;
    const modifiedAnchor = change.modifiedAnchor ?? change.modifiedContextAnchor;
    const [originalTarget, modifiedTarget] = await Promise.all([
      locate(original, originalAnchor, !change.originalAnchor),
      locate(modified, modifiedAnchor, !change.modifiedAnchor),
    ]);
    targets.set(change.id, { original: originalTarget, modified: modifiedTarget });
    const inkModels = buildReviewInkModel([change]);
    for (const model of inkModels) {
      const document = model.side === "original" ? original : modified;
      const geometry = await materializeReviewInk(model, document).catch(() => undefined);
      if (geometry) reviewInk[model.side].push(geometry);
    }
    onProgress(index + 1, changes.length);
    // Engine geometry calls are synchronous; keep eager mapping in short UI batches.
    if ((index + 1) % 2 === 0) await yieldToBrowser();
  }
  return { targets, reviewInk };
}

async function locate(
  document: LensDocument,
  anchor: DocumentAnchor | undefined,
  contextual: boolean,
): Promise<LocatedTarget> {
  if (!anchor) return { contextual: false };
  try {
    if (anchor.target === "body-text" && document.interaction) {
      return {
        target: await document.interaction.resolveTextTarget(anchor),
        contextual,
      };
    }
    return {
      target: await document.rendering.resolveVisualTarget(anchor),
      contextual,
    };
  } catch {
    return { contextual: false };
  }
}

async function measure<T>(operation: () => T | Promise<T>): Promise<{ value: T; durationMs: number }> {
  const startedAt = performance.now();
  const value = await operation();
  return { value, durationMs: Number((performance.now() - startedAt).toFixed(3)) };
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function loadStageLabel(side: string, stage?: LoadStage): string {
  const label = {
    reading: "파일 확인 중",
    fingerprinting: "로컬 fingerprint 계산 중",
    opening: "문서 구조 여는 중",
    snapshot: "본문 snapshot 생성 중",
    "cache-hit": "세션 분석 cache 재사용 중",
  }[stage ?? "reading"];
  return `${side}: ${label}`;
}

function progressLabel(progress: AnalysisProgress): string {
  if (progress.total && progress.current !== undefined) {
    return `${progress.label} ${progress.current} / ${progress.total}`;
  }
  return progress.label;
}

function analysisMessage(
  original: LoadedSide,
  modified: LoadedSide,
  progress: AnalysisProgress,
): string {
  if (original.status === "loading") return loadStageLabel("Original", original.stage);
  if (modified.status === "loading") return loadStageLabel("Modified", modified.stage);
  return progressLabel(progress);
}
