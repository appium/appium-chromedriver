import xml.etree.ElementTree as ET
from typing import List
import re
import sys
from distutils.version import LooseVersion


CD_VERSION_RE = re.compile(r'(\d+\.\d+\.\d+\.\d+)')
MAPPING_START_RE = re.compile(r'const CHROMEDRIVER_CHROME_MAPPING\s+=\s+\{')
MAPPING_RE = re.compile(r'^const CHROMEDRIVER_CHROME_MAPPING\s+=\s+\{$([^\}]+)', re.M)
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


def extract_known_versions(js_path: str) -> List[str]:
    with open(js_path, 'r') as f:
        js_content = f.read()
    match = MAPPING_RE.search(js_content)
    if not match:
        raise ValueError(f'{js_path} does not contain CHROMEDRIVER_CHROME_MAPPING constant')
    result = []
    for line in match.group(1).split('\n'):
        version_match = CD_VERSION_RE.search(line)
        if version_match:
            ver = version_match.group(1)
            if ver not in result and LooseVersion(ver) > MIN_CD_VERSION:
                result.append(ver)
    return result


def write_new_versions(js_path: str, versions: List[str]) -> None:
    with open(js_path, 'r') as f:
        js_content = f.read()
    result = js_content.split('\n')
    insert_pos = -1
    for idx, line in enumerate(result):
        if MAPPING_START_RE.match(line):
            insert_pos = idx + 2
            break
    if insert_pos < 0:
        raise ValueError(f'{js_path} does not contain CHROMEDRIVER_CHROME_MAPPING constant')
    for version in versions:
        result.insert(insert_pos, f"  '{version}': '{version}',")
    with open(js_path, 'w') as f:
        f.write('\n'.join(result))


if __name__ == '__main__':
    avail_versions = extract_available_versions(sys.argv[1])
    known_versions = extract_known_versions(sys.argv[2])
    for known_version in known_versions:
        if known_version in avail_versions:
            avail_versions.remove(known_version)
    if avail_versions:
        write_new_versions(sys.argv[2], avail_versions)
