import tempfile
import unittest
from pathlib import Path
from issue_store import IssueStore


class IssueStoreTest(unittest.TestCase):
    def test_new_issue_is_recorded_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = IssueStore(Path(tmp) / "issues.json")
            annotated = store.record([
                {"issue_id": "ISSUE-1", "category": "requirements", "severity": "high",
                 "finding": "ambiguous phrase", "status": "open"},
            ])
            self.assertEqual(annotated[0]["occurrences"], 1)
            self.assertNotIn("duplicate_of", annotated[0])

    def test_repeated_finding_is_flagged_as_duplicate(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "issues.json"
            store = IssueStore(path)
            first = {"issue_id": "ISSUE-1", "category": "requirements", "severity": "high",
                     "finding": "ambiguous phrase", "status": "open"}
            second = {"issue_id": "ISSUE-2", "category": "requirements", "severity": "high",
                      "finding": "ambiguous phrase", "status": "open"}

            store.record([first])
            annotated = IssueStore(path).record([second])

            self.assertEqual(annotated[0]["occurrences"], 2)
            self.assertEqual(annotated[0]["duplicate_of"], "ISSUE-1")

    def test_different_findings_are_not_duplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = IssueStore(Path(tmp) / "issues.json")
            annotated = store.record([
                {"issue_id": "ISSUE-1", "category": "requirements", "severity": "high",
                 "finding": "finding A", "status": "open"},
                {"issue_id": "ISSUE-2", "category": "requirements", "severity": "high",
                 "finding": "finding B", "status": "open"},
            ])
            self.assertNotIn("duplicate_of", annotated[0])
            self.assertNotIn("duplicate_of", annotated[1])


if __name__ == "__main__":
    unittest.main()
