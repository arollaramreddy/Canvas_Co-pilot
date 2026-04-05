import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildFeed,
  draftReply,
  loadMessages,
  loadRuntimeState,
  runAutonomousMonitor,
  savePreferences,
  sendReply,
} from "./autonomousInboxApi";
import { DEFAULT_PREFERENCES } from "./AutonomousAgentsWorkingView";

const EMPTY_PARAMS = {};

function setNestedValue(object, path, value) {
  const keys = path.split(".");
  const result = { ...object };
  let pointer = result;

  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    pointer[key] = { ...(pointer[key] || {}) };
    pointer = pointer[key];
  }

  pointer[keys[keys.length - 1]] = value;
  return result;
}

export default function useAutonomousInboxFeed(initialParams, currentUserName = "") {
  const stableParams = initialParams || EMPTY_PARAMS;
  const [runtimeState, setRuntimeState] = useState(null);
  const [rawMessages, setRawMessages] = useState([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [draftingMessageId, setDraftingMessageId] = useState(null);
  const [sendingMessageId, setSendingMessageId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [runtimeResult, messagesResult] = await Promise.allSettled([
        loadRuntimeState(stableParams),
        loadMessages(20),
      ]);

      if (messagesResult.status === "fulfilled") {
        setRawMessages(messagesResult.value || []);
      } else {
        setRawMessages([]);
      }

      if (runtimeResult.status === "fulfilled") {
        setRuntimeState(runtimeResult.value);
      } else {
        setRuntimeState(null);
        if (messagesResult.status !== "fulfilled") {
          throw runtimeResult.reason;
        }
        setError(runtimeResult.reason?.message || "Runtime state unavailable, showing raw inbox only");
      }
    } catch (err) {
      setError(err.message || "Failed to load autonomous inbox state");
    } finally {
      setLoading(false);
    }
  }, [stableParams]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setError("");
    try {
      await runAutonomousMonitor();
      const [runtimeResult, messagesResult] = await Promise.allSettled([
        loadRuntimeState(stableParams),
        loadMessages(20),
      ]);

      if (messagesResult.status === "fulfilled") {
        setRawMessages(messagesResult.value || []);
      } else {
        setRawMessages([]);
      }

      if (runtimeResult.status === "fulfilled") {
        setRuntimeState(runtimeResult.value);
      } else {
        setRuntimeState(null);
        if (messagesResult.status !== "fulfilled") {
          throw runtimeResult.reason;
        }
        setError(runtimeResult.reason?.message || "Runtime state unavailable, showing raw inbox only");
      }
    } catch (err) {
      setError(err.message || "Failed to sync autonomous inbox state");
    } finally {
      setSyncing(false);
    }
  }, [stableParams]);

  const onPreferenceChange = useCallback(async (path, value) => {
    const next = setNestedValue(preferences, path, value);
    setPreferences(next);
    try {
      await savePreferences(next);
    } catch (err) {
      setError(err.message || "Failed to save preferences");
    }
  }, [preferences]);

  const onDraftReply = useCallback(async (item) => {
    if (!item?.id) return;
    setDraftingMessageId(item.id);
    setError("");
    try {
      const result = await draftReply(item.id);
      setDrafts((current) => ({
        ...current,
        [item.id]: result.draft || "",
      }));
    } catch (err) {
      setError(err.message || "Failed to draft reply");
    } finally {
      setDraftingMessageId(null);
    }
  }, []);

  const onSendReply = useCallback(async (item) => {
    if (!item?.id) return;
    setSendingMessageId(item.id);
    setError("");
    let draft = drafts[item.id];
    if (!draft) {
      try {
        const result = await draftReply(item.id);
        draft = result.draft || "";
        setDrafts((current) => ({
          ...current,
          [item.id]: draft,
        }));
      } catch (err) {
        setError(err.message || "Failed to draft reply before sending");
        setSendingMessageId(null);
        return;
      }
    }

    try {
      await sendReply(item.id, draft);
      await syncNow();
    } catch (err) {
      setError(err.message || "Failed to send reply");
    } finally {
      setSendingMessageId(null);
    }
  }, [drafts, syncNow]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const feed = useMemo(
    () => buildFeed(runtimeState, preferences, rawMessages, currentUserName),
    [runtimeState, preferences, rawMessages, currentUserName]
  );

  return {
    drafts,
    error,
    feed,
    loading,
    draftingMessageId,
    onDraftReply,
    onPreferenceChange,
    onSendReply,
    preferences,
    rawMessages,
    refresh,
    runtimeState,
    sendingMessageId,
    syncNow,
    syncing,
  };
}
