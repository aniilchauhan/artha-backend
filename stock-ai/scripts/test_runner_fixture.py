import sys

if "--fail" in sys.argv:
    sys.stderr.write("Simulated error occurred\n")
    sys.exit(1)

sys.stdout.write("Simulated success\n")
sys.exit(0)
