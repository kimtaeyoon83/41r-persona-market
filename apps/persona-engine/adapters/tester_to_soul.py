"""41rpm TesterProfile → persona_agent Soul markdown + 5-axis traits.

Input shape mirrors packages/shared/src/types.ts `TesterProfile`. The
conversion picks sensible defaults for missing fields — tuning later.
"""
from __future__ import annotations

from typing_extensions import TypedDict  # py<3.12 compat for pydantic


class TesterProfile(TypedDict, total=False):
    age_range: str          # '10s'|'20s'|'30s'|'40s'|'50s'|'60+'
    region: str
    occupation: str
    expertise: list[str]
    experience_level: str   # 'beginner'|'intermediate'|'expert'
    crypto_experience: str  # 'none'|'beginner'|'intermediate'|'advanced'
    preferred_domains: list[str]
    ui_preference: str
    languages: list[str]
    device_types: list[str]
    primary_device: str     # 'mobile'|'desktop'
    display_name: str


def _age_midpoint(age_range: str | None) -> int:
    return {
        "10s": 15, "20s": 25, "30s": 35, "40s": 45,
        "50s": 55, "60+": 65,
    }.get(age_range or "", 30)


def _experience_to_research(level: str | None) -> float:
    return {
        "beginner": 0.25, "intermediate": 0.5, "expert": 0.85,
    }.get(level or "", 0.5)


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def tester_profile_to_traits(profile: TesterProfile) -> dict[str, float]:
    """5-axis trait vector from TesterProfile (each in [0, 1]).

    Field names match persona_agent schema v1 (``profile:`` block):
    decision_speed / research_depth / privacy_sensitivity /
    price_sensitivity / visual_dependency.
    """
    primary = (profile.get("primary_device") or "").lower()
    devices = profile.get("device_types") or []
    is_mobile_first = primary == "mobile" or devices == ["mobile"]

    expertise = set(profile.get("expertise") or [])
    prefs = set(profile.get("preferred_domains") or [])
    crypto = profile.get("crypto_experience") or "none"

    research_depth = _experience_to_research(profile.get("experience_level"))
    privacy_sensitivity = 0.8 if ({"defi", "nft", "web3"} & expertise) else 0.4
    if crypto == "advanced":
        privacy_sensitivity = max(privacy_sensitivity, 0.75)

    price_sensitivity = 0.7 if "gaming" in prefs or "saas" in prefs else 0.5
    decision_speed = 0.7 if is_mobile_first else 0.4
    visual_dependency = 0.75 if profile.get("ui_preference") == "rich" else 0.5

    return {
        "decision_speed": _clamp(decision_speed),
        "research_depth": _clamp(research_depth),
        "privacy_sensitivity": _clamp(privacy_sensitivity),
        "price_sensitivity": _clamp(price_sensitivity),
        "visual_dependency": _clamp(visual_dependency),
    }


def tester_profile_to_soul_with_traits(
    profile: TesterProfile,
    persona_id: str,
) -> tuple[str, dict[str, float]]:
    """Build a persona_agent Soul markdown (YAML frontmatter + narrative)."""
    traits = tester_profile_to_traits(profile)
    name = profile.get("display_name") or persona_id
    age = _age_midpoint(profile.get("age_range"))
    region = profile.get("region") or "KR"
    occupation = profile.get("occupation") or "unspecified"
    languages = ", ".join(profile.get("languages") or ["ko"])
    devices = ", ".join(profile.get("device_types") or ["desktop"])
    expertise = ", ".join(profile.get("expertise") or []) or "general web user"
    ui_pref = profile.get("ui_preference") or "default"
    crypto = profile.get("crypto_experience") or "none"

    age_group = _age_group_for(age)
    fast = traits["decision_speed"] > 0.6

    frontmatter = f"""---
name: {name}
age: {age}
age_group: {age_group}
region: {region}
occupation: {occupation}
languages: [{languages}]
device_types: [{devices}]
expertise: [{expertise}]
crypto_experience: {crypto}
profile:
  decision_speed: {traits['decision_speed']:.2f}
  research_depth: {traits['research_depth']:.2f}
  privacy_sensitivity: {traits['privacy_sensitivity']:.2f}
  price_sensitivity: {traits['price_sensitivity']:.2f}
  visual_dependency: {traits['visual_dependency']:.2f}
generation:
  tech_literacy: {0.9 if profile.get('experience_level') == 'expert' else 0.6:.2f}
  device_preference: {profile.get('primary_device') or 'desktop'}
  social_proof_weight: 0.5
  brand_loyalty: 0.5
  ad_tolerance: 0.4
timing:
  patience_seconds: {2.0 if fast else 4.0}
  reading_wpm: {200 + int(traits['research_depth'] * 300)}
  decision_latency_sec: {0.5 if fast else 2.0}
  loading_tolerance: {'strict' if fast else 'moderate'}
---
"""

    body = _generate_narrative(name, age, occupation, traits, ui_pref, expertise)
    return frontmatter + body, traits


def _age_group_for(age: int) -> str:
    if age < 20:
        return "teen"
    if age < 30:
        return "youth"
    if age < 45:
        return "adult"
    if age < 60:
        return "middle_aged"
    return "senior"


def _generate_narrative(
    name: str, age: int, occupation: str, traits: dict[str, float],
    ui_pref: str, expertise: str,
) -> str:
    speed = traits["decision_speed"]
    research = traits["research_depth"]
    privacy = traits["privacy_sensitivity"]

    tempo = "빠르게 훑고 몇 초 안에 판단" if speed > 0.6 else "차분히 구조를 훑고 필요한 정보만"
    trust = "출처를 반드시 확인" if privacy > 0.6 else "기본 신뢰는 주되 위험 신호를 감지"
    depth = "깊이 파고드는" if research > 0.7 else "필요한 만큼만"
    ui_note = {
        "minimal": "정보 밀도가 낮은 화면을 선호",
        "rich": "정보량이 많아도 시각적 차별화가 있으면 OK",
        "dark_mode": "다크 테마 환경에 익숙",
    }.get(ui_pref, "표준 UI에 적응")

    return f"""나는 {age}세 {occupation}로, {expertise} 도메인에 익숙하다.

페이지를 만났을 때 나는 {tempo} 판단한다. {depth} 편이고, {ui_note}.
보안·프라이버시 측면에선 {trust}한다.

의사결정은 단순한 가격 비교로 끝나지 않고, 내 목적에 얼마나 직접적으로
연결되는가를 우선한다. 광고·홍보 문구보다 실제 제품 기능 / 사용자 후기 /
데이터 출처를 더 신뢰한다.
"""
