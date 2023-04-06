from typing import List, Dict
import sys
import json


def main(latest_version: str, json_path: str) -> int:
    with open(json_path, 'r') as f:
        known_versions: Dict[str, str] = json.load(f)
    if latest_version in known_versions.keys():
        return 0

    with open(json_path, 'w') as f:
        json.dump({
            latest_version: latest_version,
            **known_versions,
        }, f, indent=2)
    return 1


if __name__ == '__main__':
    print(main(sys.argv[1].strip(), sys.argv[2]))
