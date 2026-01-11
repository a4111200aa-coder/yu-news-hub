import json
import requests

# 示例：你可以根据需要修改下面的新闻源（如RSS、API）
NEWS_API_URL = "https://newsapi.org/v2/top-headlines"
API_KEY = "your_api_key"  # 需要替换为你的 API 密钥

def fetch_news():
    response = requests.get(NEWS_API_URL, params={
        'apiKey': API_KEY,
        'country': 'us',  # 选择国家，如 'us' 或 'cn'
        'category': 'technology',  # 可选：'business', 'technology', 'sports', 等
    })
    return response.json()

def save_news(news_data):
    with open('../data/items.json', 'w', encoding='utf-8') as f:
        json.dump(news_data, f, ensure_ascii=False, indent=4)

def main():
    news_data = fetch_news()
    save_news(news_data)
    print("News updated successfully!")

if __name__ == "__main__":
    main()
