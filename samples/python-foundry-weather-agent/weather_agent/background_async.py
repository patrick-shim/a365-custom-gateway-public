"""Request-scoped asyncio execution without Windows credential-helper windows."""

from __future__ import annotations

import asyncio
import copy
import subprocess
import sys
from collections.abc import Coroutine
from typing import Any, TypeVar


_T = TypeVar("_T")


if sys.platform == "win32":

    def _windowless_options(options: dict[str, Any]) -> dict[str, Any]:
        # A new/detached console would override CREATE_NO_WINDOW. Other flags,
        # redirected streams, environment and SDK timeouts remain untouched.
        flags = options.get("creationflags", 0)
        flags &= ~(subprocess.CREATE_NEW_CONSOLE | subprocess.DETACHED_PROCESS)
        options["creationflags"] = flags | subprocess.CREATE_NO_WINDOW
        startup = copy.copy(options.get("startupinfo")) or subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = subprocess.SW_HIDE
        options["startupinfo"] = startup
        return options

    class _WindowlessProactorEventLoop(asyncio.ProactorEventLoop):
        async def subprocess_exec(self, protocol_factory, *args, **kwargs):
            return await super().subprocess_exec(
                protocol_factory, *args, **_windowless_options(kwargs)
            )

        async def subprocess_shell(self, protocol_factory, cmd, **kwargs):
            return await super().subprocess_shell(
                protocol_factory, cmd, **_windowless_options(kwargs)
            )

    def _new_windowless_loop() -> asyncio.AbstractEventLoop:
        loop = _WindowlessProactorEventLoop()
        asyncio.set_event_loop(loop)
        return loop


def run_background(coroutine: Coroutine[Any, Any, _T]) -> _T:
    """Keep each Flask request's loop isolated, including concurrent requests."""
    if sys.platform != "win32":
        return asyncio.run(coroutine)

    try:
        with asyncio.Runner(loop_factory=_new_windowless_loop) as runner:
            return runner.run(coroutine)
    finally:
        # Runner only clears the current loop for its default loop factory.
        asyncio.set_event_loop(None)
