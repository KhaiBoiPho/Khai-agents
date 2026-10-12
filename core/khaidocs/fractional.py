"""Fractional indexing for sibling order (base-62 string keys).

Keys sort bytewise (``COLLATE "C"`` in SQL, plain ``<`` here). ``key_between``
returns a key strictly between two others; ``None`` means "no neighbour on
that side". The scheme is the well-known one used by the client's
``fractional-indexing-jittered``: an integer part whose first character gives
its length, then a fraction without trailing zeros, so keys the client made
are valid inputs here and the other way round.
"""

from __future__ import annotations

DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
BASE = len(DIGITS)
ZERO = DIGITS[0]
SMALLEST_INTEGER = "A" + ZERO * 26


def _integer_length(head: str) -> int:
    if "a" <= head <= "z":
        return ord(head) - ord("a") + 2
    if "A" <= head <= "Z":
        return ord("Z") - ord(head) + 2
    raise ValueError(f"invalid order key head: {head}")


def _integer_part(key: str) -> str:
    length = _integer_length(key[0])
    if length > len(key):
        raise ValueError(f"invalid order key: {key}")
    return key[:length]


def _validate(key: str) -> None:
    if key == SMALLEST_INTEGER:
        raise ValueError(f"invalid order key: {key}")
    integer = _integer_part(key)
    if key[len(integer):].endswith(ZERO):
        raise ValueError(f"invalid order key: {key}")


def _midpoint(a: str, b: str | None) -> str:
    if b is not None and a >= b:
        raise ValueError(f"{a} >= {b}")
    if a.endswith(ZERO) or (b is not None and b.endswith(ZERO)):
        raise ValueError("trailing zero")
    if b:
        n = 0
        while n < len(b) and (a[n] if n < len(a) else ZERO) == b[n]:
            n += 1
        if n > 0:
            return b[:n] + _midpoint(a[n:], b[n:])
    digit_a = DIGITS.index(a[0]) if a else 0
    digit_b = DIGITS.index(b[0]) if b else BASE
    if digit_b - digit_a > 1:
        return DIGITS[round(0.5 * (digit_a + digit_b))]
    if b and len(b) > 1:
        return b[:1]
    return DIGITS[digit_a] + _midpoint(a[1:], None)


def _increment_integer(x: str) -> str | None:
    head, digits = x[0], list(x[1:])
    carry = True
    i = len(digits) - 1
    while carry and i >= 0:
        d = DIGITS.index(digits[i]) + 1
        if d == BASE:
            digits[i] = ZERO
        else:
            digits[i] = DIGITS[d]
            carry = False
        i -= 1
    if carry:
        if head == "Z":
            return "a" + ZERO
        if head == "z":
            return None
        new_head = chr(ord(head) + 1)
        if new_head > "a":
            digits.append(ZERO)
        else:
            digits.pop()
        return new_head + "".join(digits)
    return head + "".join(digits)


def _decrement_integer(x: str) -> str | None:
    head, digits = x[0], list(x[1:])
    borrow = True
    i = len(digits) - 1
    while borrow and i >= 0:
        d = DIGITS.index(digits[i]) - 1
        if d == -1:
            digits[i] = DIGITS[-1]
        else:
            digits[i] = DIGITS[d]
            borrow = False
        i -= 1
    if borrow:
        if head == "a":
            return "Z" + DIGITS[-1]
        if head == "A":
            return None
        new_head = chr(ord(head) - 1)
        if new_head < "Z":
            digits.append(DIGITS[-1])
        else:
            digits.pop()
        return new_head + "".join(digits)
    return head + "".join(digits)


def key_between(a: str | None, b: str | None) -> str:
    if a is not None:
        _validate(a)
    if b is not None:
        _validate(b)
    if a is not None and b is not None and a >= b:
        raise ValueError(f"{a} >= {b}")
    if a is None:
        if b is None:
            return "a" + ZERO
        integer_b = _integer_part(b)
        fraction_b = b[len(integer_b):]
        if integer_b == SMALLEST_INTEGER:
            return integer_b + _midpoint("", fraction_b)
        if integer_b < b:
            return integer_b
        res = _decrement_integer(integer_b)
        if res is None:
            raise ValueError("cannot decrement any more")
        return res
    if b is None:
        integer_a = _integer_part(a)
        fraction_a = a[len(integer_a):]
        incremented = _increment_integer(integer_a)
        return integer_a + _midpoint(fraction_a, None) if incremented is None else incremented
    integer_a, integer_b = _integer_part(a), _integer_part(b)
    fraction_a, fraction_b = a[len(integer_a):], b[len(integer_b):]
    if integer_a == integer_b:
        return integer_a + _midpoint(fraction_a, fraction_b)
    incremented = _increment_integer(integer_a)
    if incremented is None:
        raise ValueError("cannot increment any more")
    if incremented < b:
        return incremented
    return integer_a + _midpoint(fraction_a, None)


def valid(key: str | None) -> bool:
    if not key:
        return False
    try:
        _validate(key)
    except (ValueError, IndexError):
        return False
    return True


def after(last: str | None) -> str:
    """A key sorting after ``last`` (the first key when there is none)."""

    return key_between(last if valid(last) else None, None)
