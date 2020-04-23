import xml.etree.ElementTree as ET
from typing import List
import re
import sys
from distutils.version import LooseVersion
import json


CD_VERSION_RE = re.compile(r'(\d+\.\d+\.\d+\.\d+)\/')
# This is the minimal number where the CD version matches to the browser version
MIN_CD_VERSION = LooseVersion('75.0.3770')


def extract_available_versions(feed_path: str) -> List[str]:
    tree = ET.parse(feed_path)
    root = tree.getroot()
    result = []
    for contents in root.iter():
        if contents.tag.find('Contents') < 0:
            continue
        for key in contents.iter():
            if key.tag.find('Key') < 0:
                continue
            match = CD_VERSION_RE.search(key.text)
            if match:
                ver = match.group(1)
                if ver not in result and LooseVersion(ver) > MIN_CD_VERSION:
                    result.append(ver)
    return result


def extract_known_versions(json_path: str) -> List[str]:
    with open(json_path, 'r') as f:
        versions_map = json.load(f)
    return [cd_ver for cd_ver in versions_map.keys() if LooseVersion(cd_ver) > MIN_CD_VERSION]


def write_new_versions(json_path: str, versions: List[str]) -> None:
    with open(json_path, 'r') as f:
        versions_map = json.load(f)
    result = {ver:ver for ver in reversed(versions)}
    result.update(versions_map)
    with open(json_path, 'w') as f:
        json.dump(result, f, indent=2)


if __name__ == '__main__':
    avail_versions = extract_available_versions(sys.argv[1])
    known_versions = extract_known_versions(sys.argv[2])
    for known_version in known_versions:
        if known_version in avail_versions:
            avail_versions.remove(known_version)
    if avail_versions:
        write_new_versions(sys.argv[2], avail_versions)
