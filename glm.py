from openai import OpenAI
import os

client = OpenAI(
    base_url="https://api.tokenrouter.com/v1",
    api_key=os.environ["TOKENROUTER_API_KEY"],
    timeout=30.0,  # fail fast instead of hanging
)

prompt = input("Ask GLM: ")

try:
    response = client.chat.completions.create(
        model="z-ai/glm-5.2-free",
        messages=[
            {"role": "system", "content": "You are an expert software engineer."},
            {"role": "user", "content": prompt},
        ],
        stream=False,  # ensure non-streaming for testing
    )
    print(response.choices[0].message.content)
except Exception as e:
    print(f"Error: {type(e).__name__}: {e}")
