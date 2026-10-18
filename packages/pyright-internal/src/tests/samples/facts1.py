# This sample file exercises the --facts report: a typed function, a
# class with inferred fields, an overload pair, and a call site.


def area(w: int, h: int) -> int:
    return w * h


from typing import overload


@overload
def pick(x: int) -> int: ...


@overload
def pick(x: str) -> str: ...


def pick(x):
    return x


class Point:
    def __init__(self, x: int, y: int):
        self.x = x
        self.y = y


value: int = area(2, 3)
chosen = pick("a")


def kitchen(a, /, b: int, *args: str, c: float = 1.5, d=2, **kwargs: int) -> None: ...
