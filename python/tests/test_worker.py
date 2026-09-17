import base64
import io
import json
import unittest
from unittest.mock import patch

from google.antigravity.types import Image, Text, ToolCall, ToolResult

from yachigravity_agent.worker import consume_response, create_prompt


class WorkerPromptTest(unittest.TestCase):
    def test_decodes_image_data_into_sdk_image_content(self) -> None:
        prompt = create_prompt(
            {
                "content": "この画像を見て",
                "images": [
                    {
                        "data": base64.b64encode(b"png-bytes").decode("ascii"),
                        "mimeType": "image/png",
                    }
                ],
            }
        )

        self.assertEqual(prompt[0], "この画像を見て")
        self.assertIsInstance(prompt[1], Image)
        self.assertEqual(prompt[1].data, b"png-bytes")
        self.assertEqual(prompt[1].mime_type, "image/png")


class WorkerResponseTest(unittest.IsolatedAsyncioTestCase):
    async def test_emits_tool_events_and_returns_text(self) -> None:
        class FakeResponse:
            @property
            def chunks(self):
                async def generate():
                    yield ToolCall(name="discord_send", args={"content": "sent"}, id="call-1")
                    yield ToolResult(name="discord_send", id="call-1", result="ok")
                    yield Text(step_index=1, text="done")

                return generate()

        output = io.StringIO()
        with patch("sys.stdout", output):
            response = await consume_response(FakeResponse())

        self.assertEqual(response, "done")
        event = json.loads(output.getvalue())
        self.assertEqual(event["event"], "step_update")
        self.assertEqual(event["step_update"]["tool_name"], "discord_send")
        self.assertEqual(event["step_update"]["tool_info"]["parameters"], {"content": "sent"})


if __name__ == "__main__":
    unittest.main()
