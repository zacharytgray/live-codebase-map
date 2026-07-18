from .helpers import thing
from . import sibling
import os


def top():
    return thing()


class Thing:
    def run(self):
        return top()
