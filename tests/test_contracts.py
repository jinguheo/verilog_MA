import unittest
from contracts_validator import load_schema, validate, is_valid
from agents.base import Agent
from agents.requirements import RequirementsAgent

ISSUE_SCHEMA = load_schema("issue.schema.json")
REQUIREMENT_SCHEMA = load_schema("requirement.schema.json")
CUSTOMER_REQUIREMENT_SCHEMA = load_schema("customer-requirement.schema.json")


class ContractsValidatorTest(unittest.TestCase):
    def test_valid_issue_passes(self):
        issue = Agent.issue("requirements", "high", "ambiguous phrase")
        self.assertTrue(is_valid(ISSUE_SCHEMA, issue))

    def test_missing_required_field_fails(self):
        errors = validate(ISSUE_SCHEMA, {"issue_id": "X", "category": "c", "severity": "low"})
        self.assertTrue(any("finding" in e for e in errors))

    def test_bad_enum_value_fails(self):
        errors = validate(ISSUE_SCHEMA, {"issue_id": "X", "category": "c", "severity": "extreme",
                                         "finding": "f", "status": "open"})
        self.assertTrue(any("severity" in e for e in errors))

    def test_requirements_agent_output_matches_schema(self):
        result = RequirementsAgent().run(
            {"requirements": "- valid input is accepted\n- output preserves ordering"}, {}
        )
        reqs = result.as_dict()["artifacts"][0]["items"]
        self.assertTrue(reqs)
        for req in reqs:
            self.assertTrue(is_valid(REQUIREMENT_SCHEMA, req), validate(REQUIREMENT_SCHEMA, req))
            self.assertTrue(is_valid(CUSTOMER_REQUIREMENT_SCHEMA, req), validate(CUSTOMER_REQUIREMENT_SCHEMA, req))


if __name__ == "__main__":
    unittest.main()
