#!/usr/bin/env python3
import sys
import json
import subprocess

def test_import():
    print("=== 测试 snscrape 导入 ===")
    try:
        import snscrape
        print(f"✅ snscrape 已安装: {snscrape.__version__}")
        return True
    except ImportError:
        print("❌ snscrape 未安装")
        return False

def install_snscrape():
    print("\n=== 尝试安装 snscrape ===")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "snscrape"])
        print("✅ snscrape 安装成功")
        return True
    except Exception as e:
        print(f"❌ 安装失败: {e}")
        return False

def test_single_tweet():
    print("\n=== 测试单条推文抓取 ===")
    tweet_url = "https://x.com/liu10102525/status/2041421845178839210"

    try:
        import snscrape.modules.twitter as sntwitter

        # 从 URL 提取推文 ID
        tweet_id = tweet_url.split("/")[-1].split("?")[0]
        print(f"推文 ID: {tweet_id}")

        # 尝试获取单条推文
        print("正在抓取...")
        tweet = next(sntwitter.TwitterTweetScraper(tweet_id).get_items())

        print("\n✅ 抓取成功!")
        print(f"用户: @{tweet.user.username}")
        print(f"时间: {tweet.date}")
        print(f"内容: {tweet.content}")
        print(f"转发: {tweet.retweetCount}")
        print(f"点赞: {tweet.likeCount}")

        result = {
            "tweet_id": tweet.id,
            "url": tweet.url,
            "content": tweet.content,
            "date": tweet.date.isoformat(),
            "user": {
                "username": tweet.user.username,
                "displayname": tweet.user.displayname,
            },
            "stats": {
                "retweets": tweet.retweetCount,
                "likes": tweet.likeCount,
                "replies": tweet.replyCount,
                "quotes": tweet.quoteCount,
            }
        }
        print("\nJSON:")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return True

    except Exception as e:
        print(f"❌ 抓取失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    print("=" * 60)
    print("snscrape 测试")
    print("=" * 60)

    has_snscrape = test_import()
    if not has_snscrape:
        if not install_snscrape():
            print("\n无法继续，请手动安装 snscrape")
            return 1

    success = test_single_tweet()

    print("\n" + "=" * 60)
    if success:
        print("🏆 snscrape 方案可行!")
        return 0
    else:
        print("⚠️ snscrape 方案失败")
        return 1

if __name__ == "__main__":
    sys.exit(main())
