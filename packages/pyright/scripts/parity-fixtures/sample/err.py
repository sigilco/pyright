import json


def takes_int(x: int) -> int:
    return x


takes_int("not an int")

bad: int = "also not an int"

json.dumps({"ok": True})
