#!/usr/bin/env python3
import sys
import subprocess
import json
import os

def get_snscrape_path():
    # Try possible paths
    paths = [
        "snscrape",
        "/Users/jerry/Library/Python/3.9/bin/snscrape",
        os.path.expanduser("~/Library/Python/3.9/bin/snscrape"),
    ]
    for p in paths:
        try:
            subprocess.check_output([p, "--help"], stderr=subprocess.STDOUT)
            return p
        except:
            continue
    return None

def test_single_tweet():
    print("\n=== 测试 snscrape CLI ===")

    tweet_url = "https://x.com/liu10102525/status/2041421845178839210"
    tweet_id = tweet_url.split("/")[-1].split("?")[0]

    snscrape_path = get_snscrape_path()
    if not snscrape_path:
        print("❌ 找不到 snscrape 命令")
        return False

    print(f"使用 snscrape: {snscrape_path}")
    print(f"推文 ID: {tweet_id}")

    try:
        # Test with tweet mode
        cmd = [snscrape_path, "--jsonl", "twitter-tweet", tweet_id]
        print(f"\n运行: {' '.join(cmd)}")
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=60)
        lines = output.decode("utf-8").strip().split("\n")

        if lines and lines[0]:
            print("\n✅ 抓取成功!")
            data = json.loads(lines[0])
            print(f"\n解析结果:")
            print(f"用户: @{data.get('user', {}).get('username', 'N/A')}")
            print(f"时间: {data.get('date', 'N/A')}")
            print(f"内容: {data.get('content', 'N/A')[:200]}...")

            result = {
                "tweet_id": data.get("id"),
                "url": data.get("url"),
                "content": data.get("content"),
                "date": data.get("date"),
                "user": {
                    "username": data.get("user", {}).get("username"),
                    "displayname": data.get("user", {}).get("displayname"),
                },
                "stats": {
                    "retweets": data.get("retweetCount"),
                    "likes": data.get("likeCount"),
                    "replies": data.get("replyCount"),
                    "quotes": data.get("quoteCount"),
                }
            }
            print("\n最终输出:")
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return True

    except subprocess.CalledProcessError as e:
        print(f"❌ 命令失败 ({e.returncode}): {e.output.decode('utf-8', errors='ignore')}")
    except Exception as e:
        print(f"❌ 失败: {e}")
        import traceback
        traceback.print_exc()

    return False

def test_user_timeline():
    print("\n=== 测试用户时间线 ===")

    snscrape_path = get_snscrape_path()
    if not snscrape_path:
        return False

    try:
        cmd = [snscrape_path, "--jsonl", "--max-results", "3", "twitter-user", "liu10102525"]
        print(f"运行: {' '.join(cmd)}")
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=60)
        lines = output.decode("utf-8").strip().split("\n")
        lines = [l for l in lines if l.strip()]

        print(f"\n✅ 抓到 {len(lines)} 条推文!")
        for i, line in enumerate(lines[:3]):
            data = json.loads(line)
            print(f"\n--- 推文 {i+1} ---")
            print(f"时间: {data.get('date')}")
            print(f"内容: {data.get('content', '')[:150]}...")

        return True
    except Exception as e:
        print(f"❌ 失败: {e}")
        return False

def main():
    print("=" * 60)
    print("snscrape CLI 测试")
    print("=" * 60)

    success = test_single_tweet()
    if success:
        test_user_timeline()

    print("\n" + "=" * 60)
    if success:
        print("🏆 snscrape CLI 方案可行!")
        return 0
    else:
        print("⚠️ 需要尝试其他方案")
        return 1

if __name__ == "__main__":
    sys.exit(main())
