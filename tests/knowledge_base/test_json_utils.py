import unittest

from src.knowledge_base.json_utils import extract_json_object


class JsonUtilsTests(unittest.TestCase):
    def test_extracts_wrapped_json(self) -> None:
        payload = extract_json_object("Result:\n{\"hello\":\"world\"}\nThanks")
        self.assertEqual(payload["hello"], "world")

    def test_rejects_non_object(self) -> None:
        with self.assertRaises(ValueError):
            extract_json_object("[1, 2, 3]")


if __name__ == "__main__":
    unittest.main()
