"""Use the operating system trust store, including locally trusted HTTPS roots."""
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass  # Requests' verified CA bundle remains the fallback.
