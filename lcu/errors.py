class LCUError(Exception):
    pass


class LockfileNotFound(LCUError):
    pass


class ClientNotRunning(LCUError):
    pass


class LCURequestError(LCUError):
    def __init__(self, status: int, path: str, body: str):
        super().__init__(f"LCU {status} on {path}: {body[:200]}")
        self.status = status
        self.path = path
        self.body = body
