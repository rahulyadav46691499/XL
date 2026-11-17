import os

from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_chroma import Chroma

load_dotenv()

embeddings = GoogleGenerativeAIEmbeddings(
    model="gemini-embedding-2-preview",
    google_api_key=os.environ.get("GOOGLE_API_KEY", "") or os.environ.get("GEMINI_API_KEY", ""),
)

vector_store = Chroma(collection_name="job_descriptions",
                      embedding_function=embeddings,
                      persist_directory="./chroma_db")
