"""Line-oriented worker that adapts the Antigravity Python SDK to Yachigravity."""

from __future__ import annotations

import asyncio
import base64
import enum
import json
import sys
from typing import Any

from google.antigravity import Agent, CapabilitiesConfig, LocalAgentConfig
from google.antigravity.hooks.policy import allow
from google.antigravity.types import Image, Text, ToolCall, ToolResult


def main() -> None:
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        return


async def run_worker() -> None:
    configuration = await read_configuration()
    agent_config = create_agent_config(configuration)

    async with Agent(agent_config) as agent:
        write_event(
            {
                "event": "init",
                "conversation_id": agent.conversation_id,
                "init": {"workspace": configuration.get("workspace")},
            }
        )

        while True:
            line = await read_line()
            if not line:
                return

            try:
                request = json.loads(line)
                response = await handle_request(agent, request)
                write_event(
                    {
                        "event": "result",
                        "result": {
                            "conversation_id": agent.conversation_id,
                            "status": "SUCCESS",
                            "response": response,
                        },
                    }
                )
            except Exception as error:  # noqa: BLE001 - report worker errors to the host
                write_event(
                    {
                        "event": "result",
                        "result": {
                            "conversation_id": agent.conversation_id,
                            "status": "ERROR",
                            "response": "",
                            "error": str(error),
                        },
                    }
                )


async def read_configuration() -> dict[str, Any]:
    line = await read_line()
    if not line:
        raise RuntimeError("worker configuration was not provided")

    value = json.loads(line)
    if not isinstance(value, dict) or value.get("event") != "configure":
        raise ValueError("first worker message must be a configure event")
    return value


async def read_line() -> str:
    return await asyncio.to_thread(sys.stdin.readline)


def create_agent_config(configuration: dict[str, Any]) -> LocalAgentConfig:
    policies = []
    if configuration.get("dangerouslySkipPermissions"):
        policies.append(allow("*"))

    kwargs: dict[str, Any] = {
        "system_instructions": required_string(configuration, "systemPrompt"),
        "capabilities": CapabilitiesConfig() if configuration.get("dangerouslySkipPermissions") else None,
        "policies": policies or None,
        "save_dir": required_string(configuration, "saveDir"),
        "conversation_id": optional_string(configuration, "conversationId"),
        "workspaces": [required_string(configuration, "workspace")],
        "model": optional_string(configuration, "model"),
    }
    return LocalAgentConfig(**kwargs)


async def handle_request(agent: Agent, request: Any) -> str:
    if not isinstance(request, dict) or request.get("event") != "user":
        raise ValueError("worker request must be a user event")

    message = request.get("message")
    if not isinstance(message, dict):
        raise ValueError("user event is missing the message object")

    prompt = create_prompt(message)
    response = await agent.chat(prompt)
    return await consume_response(response)


def create_prompt(message: dict[str, Any]) -> list[str | Image]:
    content = message.get("content")
    if not isinstance(content, str):
        raise ValueError("user message content must be a string")

    prompt: list[str | Image] = [content]
    images = message.get("images", [])
    if not isinstance(images, list):
        raise ValueError("user message images must be a list")

    for image in images:
        if not isinstance(image, dict):
            raise ValueError("image must be an object")
        data = image.get("data")
        mime_type = image.get("mimeType")
        if not isinstance(data, str) or not isinstance(mime_type, str):
            raise ValueError("image data and mimeType are required")
        prompt.append(Image(data=base64.b64decode(data), mime_type=mime_type))

    return prompt


async def consume_response(response: Any) -> str:
    text_chunks: list[str] = []
    tool_calls: dict[str, ToolCall] = {}

    async for chunk in response.chunks:
        if isinstance(chunk, Text):
            text_chunks.append(chunk.text)
        elif isinstance(chunk, ToolCall):
            if chunk.id is not None:
                tool_calls[chunk.id] = chunk
        elif isinstance(chunk, ToolResult):
            emit_tool_step(chunk, tool_calls.pop(chunk.id, None))

    return "".join(text_chunks)


def emit_tool_step(result: ToolResult, call: ToolCall | None) -> None:
    tool_name = enum_value(result.name)
    tool_info: dict[str, Any] = {
        "name": tool_name,
        "parameters": call.args if call is not None else {},
        "output": result.result,
    }
    if result.error is not None:
        tool_info["error"] = result.error

    write_event(
        {
            "event": "step_update",
            "step_update": {
                "state": "DONE",
                "step_type": "tool",
                "tool_name": tool_name,
                "tool_info": tool_info,
            },
        }
    )


def enum_value(value: Any) -> str:
    if isinstance(value, enum.Enum):
        return str(value.value)
    return str(value)


def write_event(event: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(event, ensure_ascii=False, default=json_default) + "\n")
    sys.stdout.flush()


def json_default(value: Any) -> Any:
    if isinstance(value, enum.Enum):
        return value.value
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    return str(value)


def required_string(configuration: dict[str, Any], name: str) -> str:
    value = configuration.get(name)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty string")
    return value


def optional_string(configuration: dict[str, Any], name: str) -> str | None:
    value = configuration.get(name)
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty string when provided")
    return value
