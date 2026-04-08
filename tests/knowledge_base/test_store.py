import os
import unittest
import uuid
from importlib import reload
from pathlib import Path

import src.knowledge_base.config as config_module
import src.knowledge_base.store as store_module


class KnowledgeBaseStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = Path(f"tmp/test-knowledge-base-{uuid.uuid4().hex}").resolve()
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        os.environ["AI_KNOWLEDGE_BASE_DATA_DIR"] = str(self.temp_dir)
        reload(config_module)
        reload(store_module)
        store_module.initialize_store()

    def tearDown(self) -> None:
        os.environ.pop("AI_KNOWLEDGE_BASE_DATA_DIR", None)
        reload(config_module)
        reload(store_module)

    def test_create_document_persists_cards_and_annotations(self) -> None:
        document = store_module.create_document(
            title="AI frameworks",
            source_type="video",
            source_url="https://example.com/video",
            raw_content="Superpowers and GSD both improve AI coding quality.",
            ai_summary="A comparison of AI coding frameworks.",
            knowledge_cards=[
                {
                    "title": "GSD handles context rot",
                    "summary": "Use isolated sessions and disk state.",
                    "topic": "AI optimization",
                    "tags": ["GSD", "context rot"],
                    "confidence": 0.8,
                }
            ],
            annotations=[{"note": "GSD worth trying", "signalType": "use_later"}],
        )

        loaded = store_module.get_document(int(document["id"]))
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded["title"], "AI frameworks")
        self.assertEqual(len(loaded["knowledgeCards"]), 1)
        self.assertEqual(loaded["knowledgeCards"][0]["topic"], "AI optimization")
        self.assertEqual(len(loaded["annotations"]), 1)
        self.assertEqual(loaded["annotations"][0]["signalType"], "use_later")

    def test_keyword_search_matches_card_content(self) -> None:
        store_module.create_document(
            title="Video note",
            source_type="note",
            raw_content="raw body",
            knowledge_cards=[{"title": "Auto research mode", "summary": "Loop on experiment metrics", "topic": "AI optimization"}],
        )

        results = store_module.keyword_search("research", limit=5)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["title"], "Video note")

    def test_delete_document_cascades_related_rows(self) -> None:
        document = store_module.create_document(
            title="Delete me",
            source_type="note",
            raw_content="raw body",
            knowledge_cards=[{"title": "Card", "summary": "Loop on experiment metrics", "topic": "AI optimization"}],
            annotations=[{"note": "Remove this too", "signalType": "use_later"}],
        )

        deleted = store_module.delete_document(int(document["id"]))

        self.assertTrue(deleted)
        self.assertIsNone(store_module.get_document(int(document["id"])))
        with store_module.get_connection() as connection:
            card_count = connection.execute("SELECT COUNT(*) FROM knowledge_cards WHERE document_id = ?", (int(document["id"]),)).fetchone()[0]
            annotation_count = connection.execute("SELECT COUNT(*) FROM annotations WHERE document_id = ?", (int(document["id"]),)).fetchone()[0]
        self.assertEqual(card_count, 0)
        self.assertEqual(annotation_count, 0)

    def test_find_documents_by_title_returns_most_recent_matches(self) -> None:
        older = store_module.create_document(
            title="Quarterly planning memo",
            source_type="note",
            raw_content="older body",
        )
        newer = store_module.create_document(
            title="Quarterly planning memo v2",
            source_type="note",
            raw_content="newer body",
        )

        results = store_module.find_documents_by_title("Quarterly planning", limit=5)

        self.assertEqual([item["id"] for item in results[:2]], [int(newer["id"]), int(older["id"])])


if __name__ == "__main__":
    unittest.main()
