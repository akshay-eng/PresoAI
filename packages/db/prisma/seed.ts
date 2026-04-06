import { PrismaClient, UserRole } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  const passwordHash = await hash("password123", 12);

  const adminUser = await prisma.user.upsert({
    where: { email: "admin@slideforge.dev" },
    update: {},
    create: {
      email: "admin@slideforge.dev",
      name: "Admin User",
      passwordHash,
      role: UserRole.ADMIN,
    },
  });

  const demoUser = await prisma.user.upsert({
    where: { email: "demo@slideforge.dev" },
    update: {},
    create: {
      email: "demo@slideforge.dev",
      name: "Demo User",
      passwordHash,
      role: UserRole.USER,
    },
  });

  const defaultModels = [
    {
      id: "default-openai",
      name: "GPT-4o",
      provider: "openai",
      model: "gpt-4o",
      isDefault: false,
      temperature: 0.7,
      maxTokens: 4096,
    },
    {
      id: "default-anthropic-sonnet",
      name: "Claude Sonnet 4",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      isDefault: false,
      temperature: 0.7,
      maxTokens: 8192,
    },
    {
      id: "default-anthropic-opus",
      name: "Claude Opus 4",
      provider: "anthropic",
      model: "claude-opus-4-20250514",
      isDefault: false,
      temperature: 0.7,
      maxTokens: 8192,
    },
    {
      id: "default-gemini-flash",
      name: "Gemini 2.0 Flash",
      provider: "google",
      model: "gemini-2.0-flash",
      isDefault: false,
      temperature: 0.7,
      maxTokens: 8192,
    },
    {
      id: "default-gemini-25-pro",
      name: "Gemini 2.5 Pro",
      provider: "google",
      model: "gemini-2.5-pro",
      isDefault: true,
      temperature: 0.7,
      maxTokens: 65536,
    },
    {
      id: "default-gemini-25-flash",
      name: "Gemini 2.5 Flash",
      provider: "google",
      model: "gemini-2.5-flash",
      isDefault: false,
      temperature: 0.7,
      maxTokens: 65536,
    },
    {
      id: "default-gemini-31-pro",
      name: "Gemini 3.1 Pro",
      provider: "google",
      model: "gemini-3.1-pro-preview",
      isDefault: false,
      temperature: 0.7,
      maxTokens: 65536,
    },
    {
      id: "default-mistral",
      name: "Mistral Large",
      provider: "mistral",
      model: "mistral-large-latest",
      isDefault: false,
      temperature: 0.7,
      maxTokens: 4096,
    },
  ];

  for (const modelConfig of defaultModels) {
    const { id, ...data } = modelConfig;
    await prisma.lLMConfig.upsert({
      where: { id },
      update: { name: data.name, model: data.model, maxTokens: data.maxTokens },
      create: { id, ...data },
    });
  }

  console.log("Seeded users:", { adminUser: adminUser.id, demoUser: demoUser.id });
  console.log("Seeded default LLM configs");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
