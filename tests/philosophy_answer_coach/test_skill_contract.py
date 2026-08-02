from pathlib import Path
import json
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]
SKILL_ROOT = REPO_ROOT / "skills" / "philosophy-answer-coach"


class SkillStructureTests(unittest.TestCase):
    def test_required_files_exist(self):
        required = [
            "SKILL.md",
            "agents/openai.yaml",
            "references/evaluation-protocol.md",
            "references/kant-freedom-pilot.md",
            "references/experiment-guide.md",
            "assets/session-record-template.md",
        ]
        for relative_path in required:
            with self.subTest(relative_path=relative_path):
                self.assertTrue((SKILL_ROOT / relative_path).is_file())

    def test_frontmatter_uses_stable_english_name(self):
        text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\nname: philosophy-answer-coach\n"))
        self.assertIn("description:", text.split("---", 2)[1])

    def test_skill_contains_required_gates_and_resource_routes(self):
        text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        required_tokens = [
            "CLARIFY_QUESTION",
            "SUBMIT_ATTEMPT",
            "REPAIR_ONE_ISSUE",
            "REWRITE",
            "CLOSE_LOOP",
            "references/evaluation-protocol.md",
            "references/kant-freedom-pilot.md",
            "references/experiment-guide.md",
        ]
        for token in required_tokens:
            with self.subTest(token=token):
                self.assertIn(token, text)

    def test_skill_enforces_non_negotiable_behavior(self):
        text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        required_phrases = [
            "学生独立作答前不得提供完整答案",
            "一次只选择一个首要问题",
            "资料不足时标记为 `待核实`",
            "时间不得作为放行条件",
        ]
        for phrase in required_phrases:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)

    def test_protocol_defines_initial_and_revision_outputs(self):
        text = (SKILL_ROOT / "references" / "evaluation-protocol.md").read_text(
            encoding="utf-8"
        )
        required_headings = [
            "## 初次阅卷输出",
            "## 重写后输出",
            "## 思考证据",
            "## 事实依据状态",
            "## 禁止行为",
        ]
        for heading in required_headings:
            with self.subTest(heading=heading):
                self.assertIn(heading, text)

    def test_pressure_scenarios_are_complete(self):
        scenarios_path = Path(__file__).with_name("scenarios.json")
        scenarios = json.loads(scenarios_path.read_text(encoding="utf-8"))
        self.assertEqual(8, len(scenarios))
        required_fields = {
            "id",
            "student_input",
            "expected_gate",
            "expected_behavior",
            "forbidden_behavior",
        }
        expected_ids = {
            "blank",
            "knowledge_dump",
            "parallel_without_relation",
            "independent_but_factually_wrong",
            "plain_but_reasoned",
            "polished_without_argument",
            "asks_for_full_answer",
            "source_conflict",
        }
        self.assertEqual(expected_ids, {scenario["id"] for scenario in scenarios})
        for scenario in scenarios:
            with self.subTest(scenario=scenario.get("id")):
                self.assertEqual(required_fields, set(scenario))
                self.assertTrue(scenario["student_input"])
                self.assertTrue(scenario["expected_behavior"])
                self.assertTrue(scenario["forbidden_behavior"])

    def test_kant_fixture_is_an_evaluator_map_not_a_model_answer(self):
        text = (SKILL_ROOT / "references" / "kant-freedom-pilot.md").read_text(
            encoding="utf-8"
        )
        for phrase in [
            "## 题目真正要求",
            "## 最低事实边界",
            "## 可接受的多种论证路径",
            "## 常见混淆",
            "不得作为标准答案展示给学生",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)

    def test_experiment_uses_action_gates_and_minimum_pass_criteria(self):
        text = (SKILL_ROOT / "references" / "experiment-guide.md").read_text(
            encoding="utf-8"
        )
        for phrase in [
            "做过咨询 3 人",
            "未做过咨询 3 人",
            "不读取历史咨询报告",
            "不规定必须学习 60 分钟",
            "至少 4 人的重写",
            "至少 4 人能够说清",
            "至少 4 人认为诊断",
            "没有因 AI 帮助引入新的重大概念错误",
        ]:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)

    def test_session_record_preserves_before_and_after_evidence(self):
        text = (SKILL_ROOT / "assets" / "session-record-template.md").read_text(
            encoding="utf-8"
        )
        for field in [
            "初始答案",
            "首要问题",
            "干预动作",
            "重写答案",
            "前后证据",
            "学生自述改变",
        ]:
            with self.subTest(field=field):
                self.assertIn(field, text)


if __name__ == "__main__":
    unittest.main()
