import asyncio
from fastmcp import Client

async def main():
    async with Client("http://127.0.0.1:8002/sse") as c:
        tools = await c.list_tools()
        print("\n=== Available MCP Tools ===")
        for t in tools:
            print(f"  - {t.name}: {t.description}")

        print("\n=== Calling list_sources ===")
        result = await c.call_tool("list_sources", {})
        print(result)

asyncio.run(main())
