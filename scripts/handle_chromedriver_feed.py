from typing import List
import sys
import json


def extract_known_versions(json_path: str) -> List[str]:
    with open(json_path, 'r') as f:
        versions_map = json.load(f)
    return list(versions_map.keys())


def write_new_version(json_path: str, version: str) -> None:
    result = {version: version}
    with open(json_path, 'r') as f:
        result.update(json.load(f))
    with open(json_path, 'w') as f:
        json.dump(result, f, indent=2)


if __name__ == '__main__':
    latest_version = sys.argv[1].strip()
    known_versions = extract_known_versions(sys.argv[2])
    if latest_version not in known_versions:
        write_new_version(sys.argv[2], latest_version)
