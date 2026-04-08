import time

from llama_index.embeddings.huggingface import HuggingFaceEmbedding


TEXTS = [
    "针对 AI 的优化我们记录了哪些？",
    "GSD isolates context into fresh sessions to reduce context rot.",
]
MODELS = [
    "BAAI/bge-small-zh-v1.5",
    "BAAI/bge-m3",
]


def run(model_name: str) -> None:
    started = time.perf_counter()
    model = HuggingFaceEmbedding(model_name=model_name)
    load_seconds = time.perf_counter() - started

    first_started = time.perf_counter()
    first_vector = model.get_query_embedding(TEXTS[0])
    first_seconds = time.perf_counter() - first_started

    second_started = time.perf_counter()
    second_vector = model.get_query_embedding(TEXTS[1])
    second_seconds = time.perf_counter() - second_started

    print(f"MODEL={model_name}")
    print(f"  load_seconds={load_seconds:.2f}")
    print(f"  first_query_seconds={first_seconds:.2f}")
    print(f"  second_query_seconds={second_seconds:.2f}")
    print(f"  vector_dim={len(first_vector)}")
    print(f"  second_vector_dim={len(second_vector)}")


if __name__ == "__main__":
    for model_name in MODELS:
        run(model_name)
