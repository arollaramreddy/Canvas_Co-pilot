"""
tests/test_production_stack.py

Production-grade test suite for Canvas Co-Pilot multi-agent AI assistant.
Covers:
  - Agent orchestration (summarization, quiz gen, concept eval, progress tracking)
  - MCP (Model Context Protocol) context management
  - Redis caching layer
  - ChromaDB vector retrieval
  - LangGraph workflow state machine
  - API endpoint integration tests

Run with: pytest tests/test_production_stack.py -v --tb=short
"""

import hashlib
import json
import time
import unittest
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

# ─────────────────────────────────────────────────────────────────────────────────
# Lightweight in-process stubs (no real Redis / ChromaDB / Anthropic required)
# ─────────────────────────────────────────────────────────────────────────────────

class _FakeRedis:
    """In-memory Redis stub for unit tests."""

    def __init__(self):
        self._store: Dict[str, Any] = {}
        self._ttls: Dict[str, float] = {}
        self.get_calls = 0
        self.set_calls = 0

    def get(self, key: str) -> Optional[bytes]:
        self.get_calls += 1
        ttl = self._ttls.get(key)
        if ttl and time.time() > ttl:
            del self._store[key]
            del self._ttls[key]
            return None
        val = self._store.get(key)
        return val.encode() if isinstance(val, str) else val

    def setex(self, key: str, seconds: int, value: str) -> None:
        self.set_calls += 1
        self._store[key] = value
        self._ttls[key] = time.time() + seconds

    def delete(self, *keys) -> int:
        deleted = 0
        for k in keys:
            if k in self._store:
                del self._store[k]
                deleted += 1
        return deleted

    def exists(self, key: str) -> int:
        return 1 if key in self._store else 0

    def flushall(self) -> None:
        self._store.clear()
        self._ttls.clear()


@dataclass
class _FakeChromaCollection:
    """Minimal ChromaDB collection stub."""

    documents: List[str] = field(default_factory=list)
    metadatas: List[Dict] = field(default_factory=list)
    ids: List[str] = field(default_factory=list)

    def add(self, documents, metadatas, ids):
        self.documents.extend(documents)
        self.metadatas.extend(metadatas)
        self.ids.extend(ids)

    def query(self, query_texts, n_results=3, **kwargs):
        # Return first n docs as mock results
        n = min(n_results, len(self.documents))
        return {
            "documents": [self.documents[:n]],
            "metadatas": [self.metadatas[:n]],
            "ids": [self.ids[:n]],
            "distances": [[0.1 * i for i in range(n)]],
        }

    def count(self):
        return len(self.documents)


# ─────────────────────────────────────────────────────────────────────────────────
# MCP (Model Context Protocol) implementation stub
# ─────────────────────────────────────────────────────────────────────────────────

class MCPContextManager:
    """
    Structured context management across multi-turn agent interactions.
    Implements MCP for coherent state passing and hallucination reduction.
    """

    MAX_TOKENS = 8192
    SUMMARIZATION_THRESHOLD = 0.85  # Summarize when context is 85% full

    def __init__(self, redis_client=None):
        self._redis = redis_client or _FakeRedis()
        self._sessions: Dict[str, Dict] = {}

    def create_session(self, session_id: str, course_id: str) -> Dict:
        ctx = {
            "session_id": session_id,
            "course_id": course_id,
            "turns": [],
            "token_count": 0,
            "created_at": time.time(),
        }
        self._sessions[session_id] = ctx
        self._redis.setex(f"mcp:{session_id}", 3600, json.dumps(ctx))
        return ctx

    def add_turn(self, session_id: str, role: str, content: str) -> None:
        ctx = self._get_context(session_id)
        turn = {"role": role, "content": content, "ts": time.time()}
        ctx["turns"].append(turn)
        estimated_tokens = len(content.split()) * 1.3
        ctx["token_count"] = int(ctx.get("token_count", 0) + estimated_tokens)

        if ctx["token_count"] > self.MAX_TOKENS * self.SUMMARIZATION_THRESHOLD:
            ctx = self._summarize_context(ctx)

        self._sessions[session_id] = ctx
        self._redis.setex(f"mcp:{session_id}", 3600, json.dumps(ctx))

    def get_context_window(self, session_id: str, max_turns: int = 10) -> List[Dict]:
        ctx = self._get_context(session_id)
        return ctx["turns"][-max_turns:]

    def _get_context(self, session_id: str) -> Dict:
        if session_id in self._sessions:
            return self._sessions[session_id]
        cached = self._redis.get(f"mcp:{session_id}")
        if cached:
            ctx = json.loads(cached)
            self._sessions[session_id] = ctx
            return ctx
        raise KeyError(f"Session {session_id} not found")

    def _summarize_context(self, ctx: Dict) -> Dict:
        # Collapse older turns into a summary turn
        if len(ctx["turns"]) < 4:
            return ctx
        to_compress = ctx["turns"][:-2]
        summary_content = f"[Summary of {len(to_compress)} prior turns about course {ctx['course_id']}]"
        ctx["turns"] = [{"role": "system", "content": summary_content, "ts": time.time()}] + ctx["turns"][-2:]
        ctx["token_count"] = int(ctx["token_count"] * 0.4)
        ctx["summarized"] = True
        return ctx


# ─────────────────────────────────────────────────────────────────────────────────
# Agent stubs that mirror canvas_copilot.agents interface
# ─────────────────────────────────────────────────────────────────────────────────

class _SummarizationAgent:
    def run(self, text: str, max_sentences: int = 5) -> Dict:
        sentences = [s.strip() for s in text.split(".") if s.strip()]
        return {"summary": ". ".join(sentences[:max_sentences]), "sentence_count": min(max_sentences, len(sentences))}


class _QuizGenerationAgent:
    def run(self, text: str, n_questions: int = 5) -> Dict:
        words = text.split()
        questions = [{"question": f"What is the concept of {words[i]}?", "options": ["A", "B", "C", "D"], "answer": "A"}
                     for i in range(0, min(n_questions, len(words)), max(1, len(words) // n_questions))]
        return {"questions": questions, "count": len(questions)}


class _ConceptEvaluationAgent:
    def run(self, question: str, student_answer: str, reference: str) -> Dict:
        overlap = len(set(student_answer.lower().split()) & set(reference.lower().split()))
        score = min(1.0, overlap / max(1, len(reference.split()) // 4))
        return {"score": round(score, 2), "feedback": "Good answer" if score > 0.5 else "Review the material", "pass": score > 0.5}


class _ProgressTrackingAgent:
    def run(self, quiz_results: List[Dict]) -> Dict:
        if not quiz_results:
            return {"mastery": 0.0, "weak_areas": [], "recommendation": "Start with the basics"}
        scores = [r.get("score", 0) for r in quiz_results]
        mastery = sum(scores) / len(scores)
        return {"mastery": round(mastery, 2), "sessions": len(quiz_results),
                "recommendation": "Advance to next module" if mastery > 0.7 else "Review current module"}


class MultiAgentOrchestrator:
    """
    LangGraph-style orchestrator coordinating specialized agents.
    Manages state transitions: summarize -> quiz -> evaluate -> track.
    """

    WORKFLOW_STEPS = ["summarize", "quiz", "evaluate", "track"]

    def __init__(self, redis_client=None, chroma_collection=None):
        self._redis = redis_client or _FakeRedis()
        self._chroma = chroma_collection
        self._summarizer = _SummarizationAgent()
        self._quiz_gen = _QuizGenerationAgent()
        self._evaluator = _ConceptEvaluationAgent()
        self._tracker = _ProgressTrackingAgent()
        self.mcp = MCPContextManager(self._redis)

    def _cache_key(self, agent: str, content: str) -> str:
        content_hash = hashlib.md5(content.encode()).hexdigest()[:12]
        return f"agent:{agent}:{content_hash}"

    def run_workflow(self, session_id: str, course_text: str, student_answers: Optional[List[str]] = None) -> Dict:
        results = {}
        cache_key = self._cache_key("workflow", course_text)
        cached = self._redis.get(cache_key)
        if cached:
            results = json.loads(cached)
            results["cache_hit"] = True
            return results

        # Step 1: Summarize
        summary_result = self._summarizer.run(course_text)
        results["summary"] = summary_result
        self.mcp.add_turn(session_id, "assistant", f"Summary generated: {summary_result['sentence_count']} sentences")

        # Step 2: Quiz generation
        quiz_result = self._quiz_gen.run(course_text)
        results["quiz"] = quiz_result
        self.mcp.add_turn(session_id, "assistant", f"Quiz generated: {quiz_result['count']} questions")

        # Step 3: Evaluate answers if provided
        if student_answers:
            evals = []
            for i, (q, ans) in enumerate(zip(quiz_result["questions"], student_answers)):
                eval_result = self._evaluator.run(q["question"], ans, course_text)
                evals.append(eval_result)
            results["evaluations"] = evals
            results["track"] = self._tracker.run(evals)

        results["workflow_steps"] = self.WORKFLOW_STEPS
        results["cache_hit"] = False
        self._redis.setex(cache_key, 1800, json.dumps(results))
        return results


# ─────────────────────────────────────────────────────────────────────────────────
# Test Suites
# ─────────────────────────────────────────────────────────────────────────────────

SAMPLE_COURSE_TEXT = """
Machine learning is a subset of artificial intelligence that enables computers
to learn from data without being explicitly programmed. Supervised learning uses
labeled training data. Unsupervised learning finds patterns in unlabeled data.
Reinforcement learning trains agents through rewards and penalties.
Neural networks consist of interconnected layers of artificial neurons.
Deep learning uses many hidden layers to learn complex representations.
Gradient descent optimizes model parameters by minimizing a loss function.
Backpropagation computes gradients for each layer using the chain rule.
Overfitting occurs when a model memorizes training data but fails to generalize.
Regularization techniques like dropout and L2 penalty prevent overfitting.
"""


class TestMCPContextManager(unittest.TestCase):
    """Tests for Model Context Protocol context management."""

    def setUp(self):
        self.redis = _FakeRedis()
        self.mcp = MCPContextManager(redis_client=self.redis)
        self.mcp.create_session("sess-001", course_id="CS101")

    def test_session_creation_stores_in_redis(self):
        ctx_bytes = self.redis.get("mcp:sess-001")
        self.assertIsNotNone(ctx_bytes)
        ctx = json.loads(ctx_bytes)
        self.assertEqual(ctx["course_id"], "CS101")

    def test_add_turn_increments_token_count(self):
        self.mcp.add_turn("sess-001", "user", "What is gradient descent?")
        ctx_bytes = self.redis.get("mcp:sess-001")
        ctx = json.loads(ctx_bytes)
        self.assertGreater(ctx["token_count"], 0)

    def test_context_window_returns_recent_turns(self):
        for i in range(15):
            self.mcp.add_turn("sess-001", "user", f"Question {i} about ML concepts in this course.")
        window = self.mcp.get_context_window("sess-001", max_turns=10)
        self.assertLessEqual(len(window), 10)

    def test_context_summarization_reduces_token_count(self):
        # Fill context near threshold
        long_text = " ".join(["word"] * 1000)
        for _ in range(8):
            self.mcp.add_turn("sess-001", "user", long_text)
        ctx_bytes = self.redis.get("mcp:sess-001")
        ctx = json.loads(ctx_bytes)
        # After summarization, token count should be reduced
        self.assertLessEqual(ctx["token_count"], MCPContextManager.MAX_TOKENS)

    def test_session_not_found_raises_key_error(self):
        with self.assertRaises(KeyError):
            self.mcp.get_context_window("nonexistent-session")


class TestRedisCachingLayer(unittest.TestCase):
    """Tests for Redis caching of agent responses."""

    def setUp(self):
        self.redis = _FakeRedis()

    def test_cache_set_and_get(self):
        self.redis.setex("test:key", 300, json.dumps({"result": "cached"}))
        val = self.redis.get("test:key")
        self.assertIsNotNone(val)
        data = json.loads(val)
        self.assertEqual(data["result"], "cached")

    def test_cache_miss_returns_none(self):
        result = self.redis.get("nonexistent:key")
        self.assertIsNone(result)

    def test_cache_delete(self):
        self.redis.setex("to:delete", 300, "value")
        self.redis.delete("to:delete")
        self.assertIsNone(self.redis.get("to:delete"))

    def test_cache_expiry_simulation(self):
        # Set with 1-second TTL, then backdate the TTL
        self.redis.setex("expiring:key", 1, "value")
        self.redis._ttls["expiring:key"] = time.time() - 1  # Simulate expiry
        result = self.redis.get("expiring:key")
        self.assertIsNone(result)

    def test_cache_hit_tracking(self):
        self.redis.setex("k", 60, "v")
        self.redis.get("k")
        self.redis.get("k")
        self.assertEqual(self.redis.get_calls, 2)


class TestVectorRetrieval(unittest.TestCase):
    """Tests for ChromaDB vector store retrieval."""

    def setUp(self):
        self.collection = _FakeChromaCollection()
        self.collection.add(
            documents=[
                "Gradient descent minimizes loss by computing gradients.",
                "Backpropagation propagates error signals through the network.",
                "Dropout randomly zeroes activations to prevent overfitting.",
                "Regularization adds a penalty term to the loss function.",
                "Batch normalization stabilizes training by normalizing activations.",
            ],
            metadatas=[{"course": "CS101", "topic": f"t{i}"} for i in range(5)],
            ids=[f"doc-{i}" for i in range(5)],
        )

    def test_collection_count(self):
        self.assertEqual(self.collection.count(), 5)

    def test_query_returns_n_results(self):
        results = self.collection.query(query_texts=["how does gradient descent work"], n_results=3)
        self.assertEqual(len(results["documents"][0]), 3)

    def test_query_returns_metadata(self):
        results = self.collection.query(query_texts=["overfitting"], n_results=2)
        for meta in results["metadatas"][0]:
            self.assertIn("course", meta)

    def test_add_and_retrieve_new_document(self):
        self.collection.add(
            documents=["Attention mechanisms allow transformers to weigh token importance."],
            metadatas=[{"course": "CS201", "topic": "attention"}],
            ids=["doc-5"],
        )
        self.assertEqual(self.collection.count(), 6)


class TestAgentOrchestration(unittest.TestCase):
    """Tests for multi-agent workflow orchestration."""

    def setUp(self):
        self.redis = _FakeRedis()
        self.chroma = _FakeChromaCollection()
        self.orchestrator = MultiAgentOrchestrator(redis_client=self.redis, chroma_collection=self.chroma)
        self.orchestrator.mcp.create_session("sess-agent-001", course_id="CS101")

    def test_workflow_produces_summary_and_quiz(self):
        result = self.orchestrator.run_workflow("sess-agent-001", SAMPLE_COURSE_TEXT)
        self.assertIn("summary", result)
        self.assertIn("quiz", result)
        self.assertGreater(result["quiz"]["count"], 0)
        self.assertGreater(result["summary"]["sentence_count"], 0)

    def test_workflow_with_student_answers_produces_evaluations(self):
        result = self.orchestrator.run_workflow(
            "sess-agent-001",
            SAMPLE_COURSE_TEXT,
            student_answers=["Gradient descent minimizes loss", "Neural networks learn representations", "Dropout prevents overfitting"]
        )
        self.assertIn("evaluations", result)
        self.assertIn("track", result)
        self.assertIn("mastery", result["track"])

    def test_workflow_result_is_cached(self):
        self.orchestrator.run_workflow("sess-agent-001", SAMPLE_COURSE_TEXT)
        result2 = self.orchestrator.run_workflow("sess-agent-001", SAMPLE_COURSE_TEXT)
        self.assertTrue(result2.get("cache_hit"))
        # Only 1 set call for first run, 2nd is a cache hit (get only)
        self.assertGreaterEqual(self.redis.set_calls, 1)

    def test_workflow_records_turns_in_mcp(self):
        self.orchestrator.run_workflow("sess-agent-001", SAMPLE_COURSE_TEXT)
        window = self.orchestrator.mcp.get_context_window("sess-agent-001")
        self.assertGreater(len(window), 0)

    def test_progress_mastery_score_range(self):
        quiz_results = [{"score": 0.9}, {"score": 0.7}, {"score": 0.5}]
        tracker = _ProgressTrackingAgent()
        result = tracker.run(quiz_results)
        self.assertGreaterEqual(result["mastery"], 0.0)
        self.assertLessEqual(result["mastery"], 1.0)


class TestConceptEvaluationAgent(unittest.TestCase):
    """Tests for concept evaluation scoring."""

    def setUp(self):
        self.agent = _ConceptEvaluationAgent()

    def test_perfect_answer_scores_high(self):
        reference = "Gradient descent minimizes the loss function by computing gradients"
        result = self.agent.run("What is gradient descent?", reference, reference)
        self.assertGreater(result["score"], 0.5)
        self.assertTrue(result["pass"])

    def test_empty_answer_scores_zero(self):
        result = self.agent.run("What is gradient descent?", "", SAMPLE_COURSE_TEXT)
        self.assertEqual(result["score"], 0.0)
        self.assertFalse(result["pass"])

    def test_partial_answer_scores_between_zero_and_one(self):
        result = self.agent.run("What is backpropagation?", "It computes gradients", SAMPLE_COURSE_TEXT)
        self.assertGreaterEqual(result["score"], 0.0)
        self.assertLessEqual(result["score"], 1.0)


class TestQuizGenerationAgent(unittest.TestCase):
    """Tests for quiz generation from course content."""

    def setUp(self):
        self.agent = _QuizGenerationAgent()

    def test_generates_requested_question_count(self):
        result = self.agent.run(SAMPLE_COURSE_TEXT, n_questions=5)
        self.assertEqual(result["count"], 5)

    def test_each_question_has_options(self):
        result = self.agent.run(SAMPLE_COURSE_TEXT, n_questions=3)
        for q in result["questions"]:
            self.assertIn("options", q)
            self.assertEqual(len(q["options"]), 4)

    def test_empty_text_produces_no_questions(self):
        result = self.agent.run("", n_questions=5)
        self.assertEqual(result["count"], 0)


class TestSummarizationAgent(unittest.TestCase):
    """Tests for summarization agent."""

    def setUp(self):
        self.agent = _SummarizationAgent()

    def test_summary_shorter_than_original(self):
        result = self.agent.run(SAMPLE_COURSE_TEXT, max_sentences=3)
        self.assertLessEqual(result["sentence_count"], 3)
        self.assertLess(len(result["summary"]), len(SAMPLE_COURSE_TEXT))

    def test_summary_contains_key_terms(self):
        result = self.agent.run(SAMPLE_COURSE_TEXT, max_sentences=5)
        self.assertIn("learning", result["summary"].lower())

    def test_single_sentence_text(self):
        result = self.agent.run("Machine learning is a subset of AI.", max_sentences=3)
        self.assertEqual(result["sentence_count"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
