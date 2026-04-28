import unittest
import code

class TestUnshieldedToken(unittest.TestCase):
    def test_imports(self):
        self.assertIsNotNone(code.os)
        self.assertIsNotNone(code.json)

    def test_module_exists(self):
        self.assertIsNotNone(code)

if __name__ == '__main__':
    unittest.main()