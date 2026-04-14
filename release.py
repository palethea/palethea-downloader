from __future__ import annotations

import argparse
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent
APP_PACKAGE_JSON = REPO_ROOT / 'app' / 'package.json'
APP_PACKAGE_LOCK = REPO_ROOT / 'app' / 'package-lock.json'
BACKEND_CARGO_TOML = REPO_ROOT / 'app' / 'native-backend' / 'Cargo.toml'
BACKEND_CARGO_LOCK = REPO_ROOT / 'app' / 'native-backend' / 'Cargo.lock'
SKIP_BRANCH_BUILD_MARKER = '[skip-desktop-branch-build]'

VERSION_INPUT_RE = re.compile(
    r'^v?(?P<major>\d+)\.(?P<minor>\d+)(?:\.(?P<patch>\d+))?(?P<suffix>(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$'
)


class ReleaseError(RuntimeError):
    pass


@dataclass(frozen=True)
class ReleaseConfig:
    mode: str
    version: str | None
    commit_message: str
    dry_run: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Commit and push normally, or bump version and create a release tag.'
    )
    parser.add_argument(
        '--mode',
        choices=['normal', 'release'],
        help='normal = commit and push only, release = bump version, commit, push, and push a version tag',
    )
    parser.add_argument('--version', help='Release version, for example 1.2.3, v0.2.0-alpha, or v5.9-beta.3')
    parser.add_argument('--commit-message', help='Commit message to use')
    parser.add_argument('--dry-run', action='store_true', help='Show what would happen without changing files or git state')
    return parser.parse_args()


def prompt_choice(prompt: str, valid_choices: tuple[str, ...]) -> str:
    while True:
        value = input(prompt).strip().lower()
        if value in valid_choices:
            return value
        print(f'Please choose one of: {", ".join(valid_choices)}')


def prompt_non_empty(prompt: str) -> str:
    while True:
        value = input(prompt).strip()
        if value:
            return value
        print('This value cannot be empty.')


def prompt_with_default(prompt: str, default_value: str) -> str:
    value = input(f'{prompt} [{default_value}]: ').strip()
    return value or default_value


def normalize_version(raw_version: str) -> tuple[str, str]:
    candidate = raw_version.strip()
    match = VERSION_INPUT_RE.fullmatch(candidate)
    if not match:
        raise ReleaseError(
            'Version must look like 1.2.3, v0.2.0-alpha, or v5.9-beta.3.'
        )

    major = match.group('major')
    minor = match.group('minor')
    patch = match.group('patch') or '0'
    suffix = match.group('suffix') or ''
    manifest_version = f'{major}.{minor}.{patch}{suffix}'
    tag_name = f'v{manifest_version}'
    return manifest_version, tag_name


def build_default_commit_message(mode: str, version: str | None) -> str:
    if mode == 'release' and version is not None:
        manifest_version, _ = normalize_version(version)
        return f'Release {manifest_version}'

    return 'Update repository'


def prompt_release_version() -> str:
    while True:
        candidate = prompt_non_empty('Version number: ')
        try:
            normalize_version(candidate)
            return candidate
        except ReleaseError as error:
            print(error)


def collect_config(args: argparse.Namespace) -> ReleaseConfig:
    mode = args.mode
    if mode is None:
        print('Choose push mode:')
        print('1. Normal upload')
        print('2. New version release push')
        selection = prompt_choice('Enter 1 or 2: ', ('1', '2'))
        mode = 'normal' if selection == '1' else 'release'

    version = args.version
    if mode == 'release' and version is None:
        version = prompt_release_version()
    elif mode == 'release' and version is not None:
        normalize_version(version)

    commit_message = args.commit_message
    if commit_message is None:
        commit_message = prompt_with_default('Commit message', build_default_commit_message(mode, version))
    else:
        commit_message = commit_message.strip() or build_default_commit_message(mode, version)

    return ReleaseConfig(mode=mode, version=version, commit_message=commit_message, dry_run=args.dry_run)


def run_command(args: list[str], *, capture_output: bool = False, check: bool = True, dry_run: bool = False) -> subprocess.CompletedProcess[str] | None:
    printable = ' '.join(args)
    if dry_run:
        print(f'[dry-run] {printable}')
        return None

    result = subprocess.run(
        args,
        cwd=REPO_ROOT,
        text=True,
        capture_output=capture_output,
        check=False,
    )

    if check and result.returncode != 0:
        message = (result.stderr or result.stdout or '').strip()
        raise ReleaseError(message or f'Command failed: {printable}')

    return result


def ensure_repo_root() -> None:
    result = run_command(['git', 'rev-parse', '--show-toplevel'], capture_output=True)
    assert result is not None
    root = Path(result.stdout.strip()).resolve()
    if root != REPO_ROOT:
        raise ReleaseError(f'Run this script from inside {REPO_ROOT}.')


def replace_once(file_path: Path, pattern: re.Pattern[str], replacement: str, *, dry_run: bool) -> bool:
    original_text = file_path.read_text(encoding='utf-8')
    updated_text, replacements = pattern.subn(replacement, original_text, count=1)
    if replacements != 1:
        raise ReleaseError(f'Could not update version in {file_path.relative_to(REPO_ROOT)}')

    if updated_text == original_text:
        return False

    if dry_run:
        print(f'[dry-run] would update {file_path.relative_to(REPO_ROOT)}')
        return True

    file_path.write_text(updated_text, encoding='utf-8', newline='\n')
    return True


def update_versions(manifest_version: str, *, dry_run: bool) -> list[Path]:
    changed_files: list[Path] = []

    package_json_changed = replace_once(
        APP_PACKAGE_JSON,
        re.compile(r'("version"\s*:\s*")[^"]+(")'),
        rf'\g<1>{manifest_version}\g<2>',
        dry_run=dry_run,
    )
    if package_json_changed:
        changed_files.append(APP_PACKAGE_JSON)

    package_lock_root_changed = replace_once(
        APP_PACKAGE_LOCK,
        re.compile(r'("version"\s*:\s*")[^"]+(")'),
        rf'\g<1>{manifest_version}\g<2>',
        dry_run=dry_run,
    )
    package_lock_package_changed = replace_once(
        APP_PACKAGE_LOCK,
        re.compile(r'("packages"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"[^"]+",\s*"version"\s*:\s*")[^"]+(")', re.S),
        rf'\g<1>{manifest_version}\g<2>',
        dry_run=dry_run,
    )
    if package_lock_root_changed or package_lock_package_changed:
        changed_files.append(APP_PACKAGE_LOCK)

    cargo_toml_changed = replace_once(
        BACKEND_CARGO_TOML,
        re.compile(r'(\[package\][\s\S]*?name\s*=\s*"palethea-native-backend"\s*\nversion\s*=\s*")[^"]+(")'),
        rf'\g<1>{manifest_version}\g<2>',
        dry_run=dry_run,
    )
    if cargo_toml_changed:
        changed_files.append(BACKEND_CARGO_TOML)

    cargo_lock_changed = replace_once(
        BACKEND_CARGO_LOCK,
        re.compile(r'(\[\[package\]\]\s*\nname\s*=\s*"palethea-native-backend"\s*\nversion\s*=\s*")[^"]+(")'),
        rf'\g<1>{manifest_version}\g<2>',
        dry_run=dry_run,
    )
    if cargo_lock_changed:
        changed_files.append(BACKEND_CARGO_LOCK)

    return changed_files


def ensure_tag_available(tag_name: str) -> None:
    local_result = run_command(
        ['git', 'rev-parse', '--verify', '--quiet', f'refs/tags/{tag_name}'],
        capture_output=True,
        check=False,
    )
    assert local_result is not None
    if local_result.returncode == 0:
        raise ReleaseError(f'Tag {tag_name} already exists locally.')

    remote_result = run_command(
        ['git', 'ls-remote', '--tags', 'origin', f'refs/tags/{tag_name}'],
        capture_output=True,
        check=False,
    )
    assert remote_result is not None
    if remote_result.returncode == 0 and remote_result.stdout.strip():
        raise ReleaseError(f'Tag {tag_name} already exists on origin.')


def has_staged_changes() -> bool:
    result = run_command(['git', 'diff', '--cached', '--quiet'], check=False)
    assert result is not None
    return result.returncode == 1


def run_cargo_checks(*, dry_run: bool) -> None:
    run_command(
        ['cargo', 'check', '--manifest-path', str(BACKEND_CARGO_TOML.relative_to(REPO_ROOT))],
        dry_run=dry_run,
    )


def commit_and_push(commit_message: str, *, dry_run: bool, skip_branch_build: bool) -> None:
    run_command(['git', 'add', '-A'], dry_run=dry_run)
    if not dry_run and not has_staged_changes():
        raise ReleaseError('There is nothing to commit.')

    commit_args = ['git', 'commit', '-m', commit_message]
    if skip_branch_build:
        commit_args.extend(['-m', SKIP_BRANCH_BUILD_MARKER])

    run_command(commit_args, dry_run=dry_run)
    run_command(['git', 'push'], dry_run=dry_run)


def create_and_push_tag(tag_name: str, *, dry_run: bool) -> None:
    run_command(['git', 'tag', '-a', tag_name, '-m', f'Release {tag_name}'], dry_run=dry_run)
    run_command(['git', 'push', 'origin', tag_name], dry_run=dry_run)


def print_success(config: ReleaseConfig, manifest_version: str | None, tag_name: str | None, changed_files: list[Path]) -> None:
    print('Succeeded.')
    if manifest_version is not None:
        print(f'Updated version to {manifest_version}.')
    if changed_files:
        print('Updated files:')
        for file_path in changed_files:
            print(f'- {file_path.relative_to(REPO_ROOT)}')
    if config.mode == 'release' and tag_name is not None:
        print(f'Pushed release tag {tag_name}.')
        print('That tag push should trigger the desktop build workflow.')
    else:
        print('Pushed current branch without creating a release tag.')


def main() -> int:
    args = parse_args()
    try:
        ensure_repo_root()
        config = collect_config(args)

        manifest_version: str | None = None
        tag_name: str | None = None
        changed_files: list[Path] = []

        if config.mode == 'release':
            assert config.version is not None
            manifest_version, tag_name = normalize_version(config.version)
            ensure_tag_available(tag_name)
            changed_files = update_versions(manifest_version, dry_run=config.dry_run)

        run_cargo_checks(dry_run=config.dry_run)

        commit_and_push(
            config.commit_message,
            dry_run=config.dry_run,
            skip_branch_build=config.mode == 'release',
        )

        if config.mode == 'release' and tag_name is not None:
            create_and_push_tag(tag_name, dry_run=config.dry_run)

        print_success(config, manifest_version, tag_name, changed_files)
        return 0
    except KeyboardInterrupt:
        print('\nCancelled.')
        return 1
    except ReleaseError as error:
        print(f'Failed: {error}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())