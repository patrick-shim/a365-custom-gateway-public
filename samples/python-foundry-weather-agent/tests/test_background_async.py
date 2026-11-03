from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pytest

from weather_agent.web import _run


def test_request_loops_are_isolated_and_closed_in_concurrent_threads():
    async def work():
        loop = asyncio.get_running_loop()
        await asyncio.sleep(0.01)
        return loop

    with ThreadPoolExecutor(max_workers=2) as executor:
        loops = list(executor.map(lambda _: _run(work()), range(4)))
    assert len({id(loop) for loop in loops}) == 4
    assert all(loop.is_closed() for loop in loops)


def test_failed_request_closes_loop_and_async_generators():
    loops = []
    finalized = []

    async def values():
        try:
            yield 1
        finally:
            finalized.append(True)

    async def work():
        loops.append(asyncio.get_running_loop())
        generator = values()
        await anext(generator)
        raise RuntimeError("synthetic failure")

    with pytest.raises(RuntimeError, match="synthetic failure"):
        _run(work())
    assert finalized == [True]
    assert loops[0].is_closed()


windows_only = pytest.mark.skipif(sys.platform != "win32", reason="Windows console behavior")


@windows_only
@pytest.mark.parametrize("shell", [False, True])
def test_actual_child_has_no_console_and_preserves_output_and_exit(shell):
    async def work():
        args = [sys.executable, "-c", (
            "import ctypes,sys; "
            "print(ctypes.windll.kernel32.GetConsoleWindow()); "
            "print('synthetic stderr',file=sys.stderr); sys.exit(7)"
        )]
        options = dict(stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        if shell:
            child = await asyncio.create_subprocess_shell(subprocess.list2cmdline(args), **options)
        else:
            child = await asyncio.create_subprocess_exec(*args, **options)
        stdout, stderr = await asyncio.wait_for(child.communicate(), 10)
        return child.returncode, stdout.decode().splitlines(), stderr.decode().strip()

    assert _run(work()) == (7, ["0"], "synthetic stderr")


@windows_only
def test_windows_options_preserve_other_flags_and_do_not_mutate_startup_info():
    from weather_agent.background_async import _windowless_options

    startup = subprocess.STARTUPINFO()
    startup.wShowWindow = 5
    options = _windowless_options({
        "creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NEW_CONSOLE,
        "startupinfo": startup,
    })
    assert options["creationflags"] == subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    assert options["startupinfo"].dwFlags & subprocess.STARTF_USESHOWWINDOW
    assert options["startupinfo"].wShowWindow == subprocess.SW_HIDE
    assert startup.wShowWindow == 5
    assert startup.dwFlags == 0


@windows_only
def test_installed_azure_cli_credential_runs_cmd_and_child_without_console(monkeypatch, tmp_path):
    import azure.identity.aio._credentials.azure_cli as cli
    from azure.identity.aio import AzureCliCredential

    evidence = tmp_path / "console.json"
    helper = tmp_path / "fake_cli.py"
    helper.write_text(
        "import ctypes,json,pathlib,time\n"
        f"pathlib.Path({str(evidence)!r}).write_text(json.dumps("
        "ctypes.windll.kernel32.GetConsoleWindow()))\n"
        "print(json.dumps({'accessToken':'synthetic-token','expires_on':int(time.time())+3600}))\n",
        encoding="utf-8",
    )
    launcher = tmp_path / "az.cmd"
    launcher.write_text(f'@echo off\n"{sys.executable}" "{helper}"\n', encoding="utf-8")
    monkeypatch.setattr(cli.shutil, "which", lambda name: str(launcher) if name == "az.cmd" else None)

    async def work():
        async with AzureCliCredential() as credential:
            return await credential.get_token("https://cognitiveservices.azure.com/.default")

    assert _run(work()).token == "synthetic-token"
    assert json.loads(evidence.read_text()) == 0
