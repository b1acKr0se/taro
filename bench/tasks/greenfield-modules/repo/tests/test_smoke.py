import unittest


class Smoke(unittest.TestCase):
    def test_package_imports(self):
        import notesite

        self.assertTrue(notesite.__doc__)


if __name__ == "__main__":
    unittest.main()
