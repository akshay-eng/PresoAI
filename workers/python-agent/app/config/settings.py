from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379"
    database_url: str = "postgresql://slideforge:slideforge_dev@localhost:5432/slideforge"

    aws_access_key_id: str = "minioadmin"
    aws_secret_access_key: str = "minioadmin"
    aws_region: str = "us-east-1"
    s3_bucket_name: str = "slideforge"
    s3_endpoint_url: str | None = "http://localhost:9000"

    openai_api_key: str = ""
    anthropic_api_key: str = ""
    google_api_key: str = ""
    mistral_api_key: str = ""
    tavily_api_key: str = ""
    logo_dev_api_key: str = ""

    python_worker_concurrency: int = 4
    libreoffice_path: str = "/opt/homebrew/bin/soffice"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
