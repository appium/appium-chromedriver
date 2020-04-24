from typing import List, Dict
import sys
import json


def main(latest_version: str, json_path: str) -> None:
    with open(json_path, 'r') as f:
        known_versions: Dict[str, str] = json.load(f)
    if latest_version in known_versions.keys():
        return

    result = {latest_version: latest_version}
    result.update(known_versions)
    with open(json_path, 'w') as f:
        json.dump(result, f, indent=2)


if __name__ == '__main__':
    main(sys.argv[1].strip(), sys.argv[2])
